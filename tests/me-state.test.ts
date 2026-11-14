import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signAccess } from '../lib/auth';
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
  process.env.STAFF_PIN = '4821';
});



const pToken = async (id = 7, tv = 1) => (await signAccess({ kind: 'participant', card_id: id, tv })).token;
const state = async (token?: string) => call('/api/me/state', { method: 'GET', token: token ?? (await pToken()) });
const card = (o: Record<string, unknown> = {}) => ({ id: 7, uid: 'ABCDEFGH23456789', status: 'active', part: 1, active_match_id: null, ...o });
const seed = (o: { card?: Record<string, unknown>; match?: unknown; slot?: unknown; order?: unknown[]; tlist?: unknown[]; glist?: unknown[]; bal?: unknown } = {}) => {
  m.tables = {
    cards: [ok({ token_version: 1 }), ok(card(o.card))],
    card_balance: ok(o.bal === undefined ? { balance: 11 } : o.bal),
    glist: ok(o.glist ?? [{ game: 'HALLIGALLI', n: 1 }, { game: 'JOKER', n: 2 }, { game: 'SLOTMACHINE', n: 1 }]),
    orders: ok(o.order ?? []),
    tlist: ok(o.tlist ?? []),
    config: ok({ value: { shop_min_plays: 2 } }),
    matches: ok(o.match ?? null),
    match_slots: ok(o.slot ?? null),
  };
};

describe('me/state', () => {
  it('토큰이 없으면 401, 스태프 토큰도 401', async () => {
    expect((await call('/api/me/state', { method: 'GET' })).statusCode).toBe(401);
    expect((await call('/api/me/state', { method: 'GET', token: await staffToken('suc1') })).statusCode).toBe(401);
  });
  it('다른 기기가 재연결했으면(token_version 불일치) 401 STALE_TOKEN', async () => {
    seed(); m.tables.cards = [ok({ token_version: 2 })];
    const r = await state();
    expect(r.statusCode).toBe(401);
    expect(r.body.code).toBe('STALE_TOKEN');
  });
  it('매치 없는 활성 카드: uid, 코인, 참여 횟수(슬롯 제외)', async () => {
    seed();
    const r = await state();
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({
      ok: true, card: { id: 7, uid: 'ABCDEFGH23456789', status: 'active', part: 1 },
      balance: 11, plays: 3, shop_min_plays: 2, match: null, order: null, last: null, exit_reason: null,
    });
  });
  it('베팅 대기 칸: stage scanned, 게임 이름', async () => {
    seed({
      card: { active_match_id: 5 },
      match: { id: 5, game: 'HALLIGALLI', vs: null, phase: 'prep', win: null },
      slot: { slot: 1, stage: 'scanned', bet: null, proposed_delta: null, acked_at: null },
    });
    const r = await state();
    expect(r.body.match).toEqual({ id: 5, game: 'HALLIGALLI', vs: null, phase: 'prep', slot: 1, stage: 'scanned', bet: null, proposed_delta: null, acked: false });
  });
  it('결과 확인 단계(review)에서만 proposed_delta를 준다', async () => {
    const slot = { slot: 0, stage: 'ready', bet: 6, proposed_delta: 13, acked_at: null };
    seed({ card: { active_match_id: 5 }, match: { id: 5, game: 'JOKER', vs: 'staff', phase: 'review', win: 'W' }, slot });
    expect((await state()).body.match).toMatchObject({ phase: 'review', proposed_delta: 13, bet: 6, acked: false });
    seed({ card: { active_match_id: 5 }, match: { id: 5, game: 'JOKER', vs: 'staff', phase: 'pick', win: null }, slot });
    expect((await state()).body.match.proposed_delta).toBeNull();
    seed({ card: { active_match_id: 5 }, match: { id: 5, game: 'JOKER', vs: 'staff', phase: 'review', win: 'W' }, slot: { ...slot, acked_at: 'x' } });
    expect((await state()).body.match.acked).toBe(true);
  });
  it('이미 끝난(settled) 매치나 칸이 없으면 match는 null', async () => {
    seed({ card: { active_match_id: 5 }, match: { id: 5, game: 'JOKER', vs: 'staff', phase: 'settled', win: 'W' }, slot: { slot: 0, stage: 'ready', bet: 1, proposed_delta: 1, acked_at: null } });
    expect((await state()).body.match).toBeNull();
    seed({ card: { active_match_id: 5 }, match: { id: 5, game: 'JOKER', vs: 'staff', phase: 'prep', win: null }, slot: null });
    expect((await state()).body.match).toBeNull();
  });
  it('마지막 정산과 주문 상태', async () => {
    seed({
      tlist: [{ id: 30, at: 't2', content: 'WIN HALLIGALLI vs=friends bet=4', coin_delta: 13, kind: 'RESULT' }, { id: 20, at: 't1', content: 'LOSE JOKER vs=staff bet=6', coin_delta: -6, kind: 'RESULT' }],
      order: [{ id: 9, status: 'rejected', total: 12 }],
    });
    const r = await state();
    expect(r.body.last).toEqual({ id: 30, delta: 13, at: 't2', content: 'WIN HALLIGALLI vs=friends bet=4' });
    expect(r.body.order).toEqual({ id: 9, status: 'rejected', total: 12 });
  });
  it('퇴장: 이유를 준다 (purchase / part_end / staff)', async () => {
    for (const reason of ['purchase', 'part_end', 'staff']) {
      seed({ card: { status: 'done', active_match_id: 5 }, tlist: [{ id: 40, at: 't', content: 'EXIT reason=' + reason, coin_delta: 0, kind: 'EXIT' }] });
      const r = await state();
      expect(r.body.card.status).toBe('done');
      expect(r.body.exit_reason).toBe(reason);
      expect(r.body.match).toBeNull();
    }
  });
  it('이용 제한: exit_reason = ban', async () => {
    seed({ card: { status: 'banned' }, tlist: [{ id: 41, at: 't', content: 'BAN reason=staff', coin_delta: 0, kind: 'BAN' }] });
    const r = await state();
    expect(r.body.card.status).toBe('banned');
    expect(r.body.exit_reason).toBe('ban');
  });
  it('잔고 행이 없으면 0, 설정이 없으면 최소 2회', async () => {
    seed({ bal: null }); m.tables.config = ok(null);
    const r = await state();
    expect(r.body.balance).toBe(0);
    expect(r.body.shop_min_plays).toBe(2);
  });
  it('카드가 없으면 card: null', async () => {
    seed(); m.tables.cards = [ok({ token_version: 1 }), ok(null)];
    expect((await state()).body).toEqual({ ok: true, card: null });
  });
  it('DB 오류는 500이고 내부 내용을 새지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed(); m.tables.glist = { data: null, error: { message: 'host 10.9.9.9' } };
    const r = await state();
    expect(r.statusCode).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('10.9.9.9');
  });
});
