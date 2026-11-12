import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccess, signRefresh, verifyAccess } from '../lib/auth';

const m = vi.hoisted(() => ({ enforceLimit: vi.fn(), clearLimit: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('../lib/db', () => ({
  enforceLimit: m.enforceLimit,
  clearLimit: m.clearLimit,
  db: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: m.maybeSingle }) }) }) }),
}));

import handler from '../api/[...path]';
import { routeOf, routes } from '../lib/router';

function mockRes() {
  const r = { headers: {} as Record<string, string>, statusCode: 0, body: undefined as any,
    setHeader(k: string, v: string) { r.headers[k] = v; },
    status(c: number) { r.statusCode = c; return r; },
    json(b: unknown) { r.body = b; return r; } };
  return r;
}
async function call(url: string, body: unknown = {}, method = 'POST') {
  const res = mockRes();
  await (handler as Function)({ method, url, query: {}, body, headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
  return res;
}

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = 'test-legacy-jwt-secret-for-vitest-0123456789';
  process.env.STAFF_PIN = '4321';
  m.enforceLimit.mockReset().mockResolvedValue(undefined);
  m.clearLimit.mockReset().mockResolvedValue(undefined);
  m.maybeSingle.mockReset();
});

describe('routeOf', () => {
  it('주소에서 경로만 꺼낸다', () => {
    expect(routeOf({ url: '/api/staff/enter', query: {} })).toBe('staff/enter');
    expect(routeOf({ url: '/api/staff/enter?x=1', query: {} })).toBe('staff/enter');
    expect(routeOf({ url: '/api/staff/enter/', query: {} })).toBe('staff/enter');
  });
  it('주소가 비면 query.path로 대신한다', () => {
    expect(routeOf({ url: '', query: { path: ['auth', 'refresh'] } })).toBe('auth/refresh');
  });
});

describe('dispatch', () => {
  it('없는 주소는 404 NO_ROUTE', async () => {
    const res = await call('/api/nothing/here');
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('NO_ROUTE');
  });
  it('prototype 이름으로 우회할 수 없다', async () => {
    for (const p of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect((await call('/api/' + p)).body.code).toBe('NO_ROUTE');
    }
  });
  it('등록된 주소는 전달된다 (staff/enter)', async () => {
    const res = await call('/api/staff/enter', { code: 'hg21' });
    expect(res.statusCode).toBe(200);
    expect(await verifyAccess(res.body.access.token)).toEqual({ kind: 'staff', station: 'hg21' });
  });
  it('등록된 주소는 전달된다 (auth/refresh)', async () => {
    m.maybeSingle.mockResolvedValue({ data: { status: 'active', token_version: 2 }, error: null });
    const { token } = await signRefresh({ kind: 'participant', card_id: 5, tv: 2 });
    const res = await call('/api/auth/refresh', { refresh: token });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('active');
  });
  it('허용하지 않는 방식은 405', async () => {
    expect((await call('/api/staff/enter', {}, 'GET')).statusCode).toBe(405);
  });
  it('모든 등록 경로는 소문자와 슬래시만', () => {
    for (const k of Object.keys(routes)) expect(k).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/);
  });
});
