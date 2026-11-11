import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccess, signRefresh, verifyAccess } from '../lib/auth';
import { ApiError } from '../lib/errors';
import { handle } from '../lib/http';

const m = vi.hoisted(() => ({
  enforceLimit: vi.fn(),
  clearLimit: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock('../lib/db', () => ({
  enforceLimit: m.enforceLimit,
  clearLimit: m.clearLimit,
  db: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: m.maybeSingle }) }) }) }),
}));

import enter from '../api/staff/enter';
import refresh from '../api/auth/refresh';

function mockRes() {
  const r = {
    headers: {} as Record<string, string>,
    statusCode: 0,
    body: undefined as any,
    setHeader(k: string, v: string) { r.headers[k] = v; },
    status(c: number) { r.statusCode = c; return r; },
    json(b: unknown) { r.body = b; return r; },
  };
  return r;
}
async function call(h: Function, body: unknown, opts: { method?: string; headers?: Record<string, string> } = {}) {
  const res = mockRes();
  await h({ method: opts.method ?? 'POST', body, headers: opts.headers ?? { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }, res);
  return res;
}

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = 'test-legacy-jwt-secret-for-vitest-0123456789';
  process.env.STAFF_PIN = '4321';
  m.enforceLimit.mockReset().mockResolvedValue(undefined);
  m.clearLimit.mockReset().mockResolvedValue(undefined);
  m.maybeSingle.mockReset();
});

describe('handle', () => {
  it('허용하지 않는 방식은 405', async () => {
    const res = await call(enter, {}, { method: 'GET' });
    expect(res.statusCode).toBe(405);
    expect(res.body.code).toBe('METHOD_NOT_ALLOWED');
  });
  it('깨진 본문은 400', async () => {
    const res = mockRes();
    const req = { method: 'POST', headers: {} };
    Object.defineProperty(req, 'body', { get() { throw new Error('bad json'); } });
    await handle(['POST'], async () => ({}))(req as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });
  it('캐시 금지 헤더', async () => {
    const res = await call(enter, { code: 'hg21' });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});

describe('POST /api/staff/enter', () => {
  it('게임 스테이션은 코드만으로 입장', async () => {
    const res = await call(enter, { code: 'hg21' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, station: 'hg21', role: 'game' });
    expect(await verifyAccess(res.body.access.token)).toEqual({ kind: 'staff', station: 'hg21' });
  });
  it('대문자 코드도 입장', async () => {
    expect((await call(enter, { code: 'HG21' })).body.station).toBe('hg21');
  });
  it('suc1은 PIN 없이 입장', async () => {
    const res = await call(enter, { code: 'suc1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.role).toBe('issue');
  });
  it('suc2는 PIN 없으면 PIN_REQUIRED (PIN 횟수는 안 셈)', async () => {
    const res = await call(enter, { code: 'suc2' });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('PIN_REQUIRED');
    expect(m.enforceLimit).toHaveBeenCalledTimes(1);
  });
  it('틀린 PIN은 WRONG_PIN, 횟수 초기화 안 함', async () => {
    const res = await call(enter, { code: 'suc2', pin: '0000' });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('WRONG_PIN');
    expect(m.clearLimit).not.toHaveBeenCalled();
  });
  it('맞는 PIN은 입장하고 횟수 초기화', async () => {
    const res = await call(enter, { code: 'shp1', pin: '4321' });
    expect(res.statusCode).toBe(200);
    expect(res.body.role).toBe('shop_approve');
    expect(m.clearLimit).toHaveBeenCalledWith('pin:1.2.3.4');
  });
  it('모르는 코드는 400', async () => {
    const res = await call(enter, { code: 'zzzz' });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BAD_STATION');
  });
  it('시도 한도를 넘으면 429', async () => {
    m.enforceLimit.mockRejectedValue(new ApiError('RATE_LIMITED'));
    const res = await call(enter, { code: 'hg21' });
    expect(res.statusCode).toBe(429);
  });
});

describe('POST /api/auth/refresh', () => {
  it('스태프는 새 access를 받는다', async () => {
    const { token } = await signRefresh({ kind: 'staff', station: 'suc1' });
    const res = await call(refresh, { refresh: token });
    expect(res.statusCode).toBe(200);
    expect(await verifyAccess(res.body.access.token)).toEqual({ kind: 'staff', station: 'suc1' });
  });
  it('참여자는 버전이 맞으면 새 access와 상태', async () => {
    m.maybeSingle.mockResolvedValue({ data: { status: 'active', token_version: 2 }, error: null });
    const { token } = await signRefresh({ kind: 'participant', card_id: 5, tv: 2 });
    const res = await call(refresh, { refresh: token });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('active');
    expect(await verifyAccess(res.body.access.token)).toEqual({ kind: 'participant', card_id: 5, tv: 2 });
  });
  it('버전이 다르면 STALE_TOKEN', async () => {
    m.maybeSingle.mockResolvedValue({ data: { status: 'active', token_version: 3 }, error: null });
    const { token } = await signRefresh({ kind: 'participant', card_id: 5, tv: 2 });
    const res = await call(refresh, { refresh: token });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('STALE_TOKEN');
  });
  it('퇴장 카드도 갱신된다 (퇴장 화면을 읽어야 해서)', async () => {
    m.maybeSingle.mockResolvedValue({ data: { status: 'done', token_version: 1 }, error: null });
    const { token } = await signRefresh({ kind: 'participant', card_id: 5, tv: 1 });
    const res = await call(refresh, { refresh: token });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('done');
  });
  it('대기 카드와 없는 카드는 UNAUTHORIZED', async () => {
    const { token } = await signRefresh({ kind: 'participant', card_id: 5, tv: 1 });
    m.maybeSingle.mockResolvedValue({ data: { status: 'pending', token_version: 1 }, error: null });
    expect((await call(refresh, { refresh: token })).body.code).toBe('UNAUTHORIZED');
    m.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await call(refresh, { refresh: token })).body.code).toBe('UNAUTHORIZED');
  });
  it('엉터리 토큰과 access 토큰은 UNAUTHORIZED', async () => {
    expect((await call(refresh, { refresh: 'abc' })).statusCode).toBe(401);
    const { token } = await signAccess({ kind: 'staff', station: 'hg21' });
    expect((await call(refresh, { refresh: token })).statusCode).toBe(401);
  });
  it('DB 오류는 500이고 원문을 숨긴다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.maybeSingle.mockResolvedValue({ data: null, error: { message: 'connection refused 10.0.0.5' } });
    const { token } = await signRefresh({ kind: 'participant', card_id: 5, tv: 1 });
    const res = await call(refresh, { refresh: token });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
    spy.mockRestore();
  });
});