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


const hof = async () => call('/api/hof/list', { method: 'GET', token: await staffToken('tbs1') });
const ranks = [
  { rank: 1, card_id: 11, mask_name: '홍*동', peak: 31 },
  { rank: 2, card_id: 12, mask_name: '박*영', peak: 20 },
];

describe('hof/list', () => {
  it('캐시가 없으면 DB에서 읽고 10초 캐시에 저장한다', async () => {
    m.tables = { hof_rank: ok(ranks) };
    const res = await hof();
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.ranks).toEqual([
      { rank: 1, card_id: 11, n: '홍*동', v: 31 },
      { rank: 2, card_id: 12, n: '박*영', v: 20 },
    ]);
    expect(c.set).toHaveBeenCalledTimes(1);
    const [key, val, ttl] = c.set.mock.calls[0];
    expect(key).toBe('hof:v1');
    expect(ttl).toBe(10);
    expect(val.ranks).toHaveLength(2);
  });
  it('캐시가 있으면 DB를 읽지 않는다', async () => {
    m.tables = { hof_rank: { data: null, error: { message: 'should not be read' } } };
    c.get.mockResolvedValue({ generated_at: 'x', ranks: [{ rank: 1, card_id: 1, n: '가*나', v: 5 }] });
    const res = await hof();
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.ranks[0].v).toBe(5);
    expect(c.set).not.toHaveBeenCalled();
  });
  it('캐시 내용이 이상하면 무시하고 DB를 읽는다', async () => {
    m.tables = { hof_rank: ok(ranks) };
    c.get.mockResolvedValue({ weird: true });
    expect((await hof()).body.cached).toBe(false);
  });
  it('참가자가 없으면 빈 목록', async () => {
    m.tables = { hof_rank: ok([]) };
    expect((await hof()).body.ranks).toEqual([]);
  });
  it('tbs1만 볼 수 있다: 다른 스태프 403, 토큰 없음 401, POST 405', async () => {
    m.tables = { hof_rank: ok(ranks) };
    for (const st of ['suc1', 'suc2', 'hg21', 'shp1', 'slt1']) {
      expect((await call('/api/hof/list', { method: 'GET', token: await staffToken(st) })).statusCode).toBe(403);
    }
    expect((await call('/api/hof/list', { method: 'GET' })).statusCode).toBe(401);
    expect((await call('/api/hof/list', { method: 'POST', token: await staffToken('tbs1') })).statusCode).toBe(405);
    expect(c.get).not.toHaveBeenCalled();
  });
  it('이름 원문, 학번, 암호문은 나가지 않는다', async () => {
    m.tables = { hof_rank: ok(ranks) };
    expect(JSON.stringify((await hof()).body)).not.toMatch(/name_enc|sid|uid|secret/i);
  });
  it('DB 오류는 500이고 원문을 숨긴다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.tables = { hof_rank: { data: null, error: { message: 'host 10.9.9.9' } } };
    const res = await hof();
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('10.9.9.9');
  });
});

describe('hof/winner-pii', () => {
  const go = async (body: object, st = 'tbs1') =>
    call('/api/hof/winner-pii', { body, token: await staffToken(st) });
  const seed = (rank = 3) => {
    m.tables = {
      hof_rank: ok({ rank }),
      cards: ok({ name_enc: encrypt('홍길동'), sid_enc: encrypt('20231') }),
      audit_log: ok(null),
    };
  };
  it('PIN이 맞고 순위 안이면 실명과 학번을 주고, 열람 기록을 남긴다', async () => {
    seed(3);
    const res = await go({ card_id: '011', pin: '4821' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ card_id: 11, rank: 3, name: '홍길동', sid: '20231' });
    expect(writes()).toEqual([
      { table: 'audit_log', op: 'insert', arg: { table_name: 'pii_view', op: 'VIEW', new_row: { card_id: 11, rank: 3, station: 'tbs1' } } },
    ]);
  });
  it('열람 기록에는 이름과 학번이 들어가지 않는다', async () => {
    seed();
    await go({ card_id: 11, pin: '4821' });
    expect(JSON.stringify(writes())).not.toMatch(/홍길동|20231/);
  });
  it('PIN이 없으면 401 PIN_REQUIRED, 틀리면 WRONG_PIN, 아무 것도 읽거나 쓰지 않음', async () => {
    seed();
    const a = await go({ card_id: 11 });
    expect(a.body.code).toBe('PIN_REQUIRED');
    for (const pin of ['0000', '', 4821, null, '48210']) {
      const r = await go({ card_id: 11, pin });
      expect(r.statusCode).toBe(401);
    }
    expect(writes()).toHaveLength(0);
    expect(m.calls).toHaveLength(0);
  });
  it('PIN 시도 횟수를 제한하고, 맞으면 횟수를 지운다', async () => {
    seed();
    await go({ card_id: 11, pin: '4821' });
    expect(m.enforceLimit.mock.calls.some((x: any[]) => x[0] === 'pii-pin:1.2.3.4' && x[1] === 5)).toBe(true);
    expect(m.clearLimit).toHaveBeenCalledWith('pii-pin:1.2.3.4');
  });
  it('횟수 제한에 걸리면 429, DB는 건드리지 않는다', async () => {
    seed();
    m.enforceLimit.mockRejectedValueOnce(new ApiError('RATE_LIMITED'));
    const res = await go({ card_id: 11, pin: '4821' });
    expect(res.statusCode).toBe(429);
    expect(m.calls).toHaveLength(0);
  });
  it('우승 순위 밖의 카드는 403, 기록도 남기지 않음', async () => {
    seed(11);
    expect((await go({ card_id: 11, pin: '4821' })).statusCode).toBe(403);
    m.tables.hof_rank = ok(null); // 이용 제한 카드 등 순위에 없음
    expect((await go({ card_id: 11, pin: '4821' })).statusCode).toBe(403);
    expect(writes()).toHaveLength(0);
  });
  it('딱 10위는 허용', async () => {
    seed(10);
    expect((await go({ card_id: 11, pin: '4821' })).statusCode).toBe(200);
  });
  it('열람 기록을 못 남기면 개인정보도 주지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed();
    m.tables.audit_log = { data: null, error: { message: 'insert failed' } };
    const res = await go({ card_id: 11, pin: '4821' });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/홍길동|20231/);
  });
  it('tbs1만 가능: 다른 스태프 403, 토큰 없음 401, GET 405', async () => {
    seed();
    for (const st of ['suc1', 'suc2', 'shp1', 'hg21']) expect((await go({ card_id: 11, pin: '4821' }, st)).statusCode).toBe(403);
    expect((await call('/api/hof/winner-pii', { body: { card_id: 11, pin: '4821' } })).statusCode).toBe(401);
    expect((await call('/api/hof/winner-pii', { method: 'GET', token: await staffToken('tbs1') })).statusCode).toBe(405);
    expect(m.calls).toHaveLength(0);
  });
  it('식별번호 형식이 틀리면 400, PIN 확인 전에 거른다', async () => {
    seed();
    expect((await go({ card_id: 'x', pin: '4821' })).body.code).toBe('BAD_CARD_ID');
    expect(m.calls).toHaveLength(0);
  });
  it('암호문이 깨졌으면 500 (원문 숨김)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed();
    m.tables.cards = ok({ name_enc: 'broken', sid_enc: 'broken' });
    const res = await go({ card_id: 11, pin: '4821' });
    expect(res.statusCode).toBe(500);
  });
  it('STAFF_PIN이 서버에 없으면 500 (아무에게도 열어주지 않음)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed();
    delete process.env.STAFF_PIN;
    expect((await go({ card_id: 11, pin: '' })).statusCode).toBe(500);
    expect((await go({ card_id: 11, pin: 'undefined' })).statusCode).toBe(500);
  });
});
