import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signAccess } from '../lib/auth';
import { encrypt } from '../lib/crypto';
import { ApiError } from '../lib/errors';

type Res = { data: unknown; error: unknown };
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  enforceLimit: vi.fn(),
  clearLimit: vi.fn(),
  /** 테이블별 결과. 배열이면 호출 순서대로 하나씩 꺼내 쓴다 */
  tables: {} as Record<string, Res | Res[]>,
  calls: [] as Array<{ table: string; op: string; arg?: unknown; opt?: unknown }>,
}));
const c = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('../lib/cache', () => ({ cacheGet: c.get, cacheSet: c.set }));
vi.mock('../lib/db', () => {
  const take = (t: string): Res => {
    const v = m.tables[t];
    if (Array.isArray(v)) return v.length > 1 ? (v.shift() as Res) : (v[0] ?? { data: null, error: null });
    return v ?? { data: null, error: null };
  };
  const q = (t: string) => {
    let r: Res | null = null;
    const res = () => (r ??= take(t));
    const o: any = {
      select: () => o, order: () => o, limit: () => o, eq: () => o, in: () => o,
      insert: (arg: unknown) => { m.calls.push({ table: t, op: 'insert', arg }); return o; },
      update: (arg: unknown) => { m.calls.push({ table: t, op: 'update', arg }); return o; },
      delete: () => { m.calls.push({ table: t, op: 'delete' }); return o; },
      upsert: (arg: unknown, opt: unknown) => { m.calls.push({ table: t, op: 'upsert', arg, opt }); return o; },
      maybeSingle: () => Promise.resolve(res()),
      then: (a: any, b: any) => Promise.resolve(res()).then(a, b),
    };
    return o;
  };
  return { rpc: m.rpc, enforceLimit: m.enforceLimit, clearLimit: m.clearLimit, db: () => ({ from: (t: string) => q(t) }) };
});

import handler from '../api/index';

function mockRes() {
  const r = {
    headers: {} as Record<string, string>, statusCode: 0, body: undefined as any,
    setHeader(k: string, v: string) { r.headers[k] = v; },
    status(c: number) { r.statusCode = c; return r; },
    json(b: unknown) { r.body = b; return r; },
  };
  return r;
}
async function call(url: string, o: { body?: unknown; method?: string; token?: string } = {}) {
  const res = mockRes();
  const headers: Record<string, string> = { 'x-forwarded-for': '1.2.3.4' };
  if (o.token) headers.authorization = 'Bearer ' + o.token;
  await (handler as Function)({ method: o.method ?? 'POST', url, query: {}, body: o.body ?? {}, headers }, res);
  return res;
}
const staffToken = async (station: any) => (await signAccess({ kind: 'staff', station })).token;
const ok = (data: unknown): Res => ({ data, error: null });
const writes = () => m.calls.filter((c) => c.op !== 'select');

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = 'test-legacy-jwt-secret-for-vitest-0123456789';
  process.env.PII_ENC_KEY = randomBytes(32).toString('base64');
  process.env.SID_HMAC_KEY = randomBytes(32).toString('base64');
  m.rpc.mockReset();
  m.tables = {};
  m.calls = [];
  m.enforceLimit.mockReset();
  m.clearLimit.mockReset();
  c.get.mockReset();
  c.set.mockReset();
  c.get.mockResolvedValue(null);
  process.env.STAFF_PIN = '4821';
});



const desk = (st = 'suc1') => staffToken(st);

describe('issue/part', () => {
  it('회차를 시작/종료하고 퇴장 수를 알려준다', async () => {
    m.rpc.mockResolvedValue({ exited: 4, deferred: 1 });
    const res = await call('/api/issue/part', { body: { part: '2', status: 'ended' }, token: await desk() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ part: 2, status: 'ended', exited: 4, deferred: 1 });
    expect(m.rpc).toHaveBeenCalledWith('set_part', { p_part: 2, p_status: 'ended' });
    m.rpc.mockResolvedValue({ exited: 0, deferred: 0 });
    expect((await call('/api/issue/part', { body: { part: 1, status: 'active' }, token: await desk() })).statusCode).toBe(200);
  });
  it('회차나 상태가 이상하면 400이고 DB를 부르지 않는다', async () => {
    for (const b of [{ part: 3, status: 'active' }, { part: 1, status: 'x' }, { part: 1 }, { status: 'active' }, { part: 0, status: 'ended' }]) {
      expect((await call('/api/issue/part', { body: b, token: await desk() })).statusCode).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('suc1만 가능', async () => {
    for (const st of ['suc2', 'hg21', 'tbs1', 'shp1']) {
      expect((await call('/api/issue/part', { body: { part: 1, status: 'ended' }, token: await desk(st) })).statusCode).toBe(403);
    }
    expect((await call('/api/issue/part', { body: { part: 1, status: 'ended' } })).statusCode).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('issue/exit, issue/ban', () => {
  it('퇴장은 staff 사유로, 제한은 카드만 넘긴다', async () => {
    m.rpc.mockResolvedValue(null);
    const a = await call('/api/issue/exit', { body: { card_id: '047' }, token: await desk() });
    expect(a.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenLastCalledWith('exit_card', { p_card_id: 47, p_reason: 'staff' });
    const b = await call('/api/issue/ban', { body: { card_id: 47, reason: 'part_end' }, token: await desk() });
    expect(b.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenLastCalledWith('ban_card', { p_card_id: 47 });
  });
  it('게임 중, 주문 중, 비활성 오류 전달', async () => {
    for (const code of ['IN_MATCH', 'PENDING_ORDER', 'NOT_ACTIVE']) {
      m.rpc.mockRejectedValueOnce({ message: code });
      const res = await call('/api/issue/exit', { body: { card_id: 1 }, token: await desk() });
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe(code);
    }
    m.rpc.mockRejectedValueOnce({ message: 'NOT_FOUND' });
    expect((await call('/api/issue/ban', { body: { card_id: 1 }, token: await desk() })).statusCode).toBe(404);
  });
  it('식별번호가 틀리면 400, 권한 없으면 403/401', async () => {
    expect((await call('/api/issue/exit', { body: { card_id: 'x' }, token: await desk() })).statusCode).toBe(400);
    expect((await call('/api/issue/ban', { body: { card_id: 1 }, token: await desk('hg21') })).statusCode).toBe(403);
    expect((await call('/api/issue/exit', { body: { card_id: 1 } })).statusCode).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('issue/cards', () => {
  it('카드 표를 가린 이름으로 준다', async () => {
    m.tables = { card_summary: ok([
      { id: 1, mask_name: '홍*동', part: 1, status: 'active', coins: 7, plays: 2, current_game: 'JOKER', created_at: 'c1', activated_at: 'a1' },
      { id: 2, mask_name: '박*영', part: 1, status: 'pending', coins: 0, plays: 0, current_game: null, created_at: 'c2', activated_at: null },
    ]) };
    const res = await call('/api/issue/cards', { method: 'GET', token: await desk() });
    expect(res.statusCode).toBe(200);
    expect(res.body.cards).toEqual([
      { id: 1, name: '홍*동', part: 1, status: 'active', coins: 7, plays: 2, game: 'JOKER', at: 'a1' },
      { id: 2, name: '박*영', part: 1, status: 'pending', coins: 0, plays: 0, game: null, at: 'c2' },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/name_enc|sid|uid|secret/i);
  });
  it('suc1만, GET만', async () => {
    m.tables = { card_summary: ok([]) };
    expect((await call('/api/issue/cards', { method: 'GET', token: await desk('suc2') })).statusCode).toBe(403);
    expect((await call('/api/issue/cards', { method: 'GET' })).statusCode).toBe(401);
    expect((await call('/api/issue/cards', { method: 'POST', token: await desk() })).statusCode).toBe(405);
  });
});

describe('issue/reveal', () => {
  const seed = () => { m.tables = { cards: ok({ name_enc: encrypt('홍길동') }), audit_log: ok(null) }; };
  it('이름만 주고(학번 없음) 열람 기록을 남긴다', async () => {
    seed();
    const res = await call('/api/issue/reveal', { body: { card_id: 5 }, token: await desk() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, card_id: 5, name: '홍길동' });
    expect(writes()).toEqual([{ table: 'audit_log', op: 'insert', arg: { table_name: 'pii_view', op: 'VIEW_NAME', new_row: { card_id: 5, station: 'suc1' } } }]);
    expect(JSON.stringify(writes())).not.toContain('홍길동');
  });
  it('기록을 못 남기면 이름도 주지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed();
    m.tables.audit_log = { data: null, error: { message: 'fail' } };
    const res = await call('/api/issue/reveal', { body: { card_id: 5 }, token: await desk() });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('홍길동');
  });
  it('없는 카드 404, 형식 오류 400, 권한 없으면 403/401', async () => {
    m.tables = { cards: ok(null) };
    expect((await call('/api/issue/reveal', { body: { card_id: 5 }, token: await desk() })).statusCode).toBe(404);
    expect((await call('/api/issue/reveal', { body: { card_id: 'x' }, token: await desk() })).statusCode).toBe(400);
    seed();
    expect((await call('/api/issue/reveal', { body: { card_id: 5 }, token: await desk('tbs1') })).statusCode).toBe(403);
    expect((await call('/api/issue/reveal', { body: { card_id: 5 } })).statusCode).toBe(401);
    expect(writes()).toHaveLength(0);
  });
});
