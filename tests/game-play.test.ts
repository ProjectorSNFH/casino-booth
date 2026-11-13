import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signAccess } from '../lib/auth';
import { ApiError } from '../lib/errors';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  enforceLimit: vi.fn(),
  clearLimit: vi.fn(),
  tables: {} as Record<string, unknown>,
}));
vi.mock('../lib/db', () => {
  const q = (r: unknown) => {
    const o: any = {
      select: () => o, eq: () => o, in: () => o, is: () => o,
      single: () => Promise.resolve(r),
      maybeSingle: () => Promise.resolve(r),
      then: (a: any, b: any) => Promise.resolve(r).then(a, b),
    };
    return o;
  };
  return {
    rpc: m.rpc,
    enforceLimit: m.enforceLimit,
    clearLimit: m.clearLimit,
    db: () => ({ from: (t: string) => q(m.tables[t]) }),
  };
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

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = 'test-legacy-jwt-secret-for-vitest-0123456789';
  process.env.PII_ENC_KEY = randomBytes(32).toString('base64');
  process.env.SID_HMAC_KEY = randomBytes(32).toString('base64');
  m.rpc.mockReset();
  m.tables = {};
});




const gameStaff = (st: any = 'hg21') => staffToken(st);
const partToken = async (card_id = 47, tv = 3) => (await signAccess({ kind: 'participant', card_id, tv })).token;

describe('station actions: start, end, back, abort', () => {
  it('내 스테이션 코드로 각 DB 함수를 부른다', async () => {
    m.rpc.mockResolvedValue({ vs: 'friends' });
    const s = await call('/api/game/start', { body: { station: 'stm1' }, token: await gameStaff('hg21') });
    expect(s.statusCode).toBe(200);
    expect(s.body.vs).toBe('friends');
    expect(m.rpc).toHaveBeenCalledWith('start_match', { p_station: 'hg21' });
    m.rpc.mockResolvedValue(null);
    for (const [p, fn] of [['end', 'end_match'], ['back', 'back_to_pick'], ['abort', 'abort_match']]) {
      const r = await call('/api/game/' + p, { body: {}, token: await gameStaff('stm1') });
      expect(r.statusCode).toBe(200);
      expect(m.rpc).toHaveBeenCalledWith(fn, { p_station: 'stm1' });
    }
  });
  it('게임 스태프가 아니면 403, 토큰 없으면 401', async () => {
    for (const p of ['start', 'end', 'back', 'abort', 'result', 'settle']) {
      expect((await call('/api/game/' + p, { body: {}, token: await staffToken('suc1') })).statusCode).toBe(403);
      expect((await call('/api/game/' + p, { body: {} })).statusCode).toBe(401);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('시작 오류 PENDING_SLOTS, NO_PLAYERS, NO_MATCH 전달', async () => {
    for (const [code, st] of [['PENDING_SLOTS', 409], ['NO_PLAYERS', 409], ['NO_MATCH', 404]] as const) {
      m.rpc.mockRejectedValueOnce({ message: code });
      const res = await call('/api/game/start', { body: {}, token: await gameStaff() });
      expect(res.statusCode).toBe(st);
      expect(res.body.code).toBe(code);
    }
  });
  it('종료 BAD_PHASE 409', async () => {
    m.rpc.mockRejectedValueOnce({ message: 'BAD_PHASE' });
    expect((await call('/api/game/end', { body: {}, token: await gameStaff() })).statusCode).toBe(409);
  });
});

describe('game/result', () => {
  it('W/L과 칸 번호를 받는다 (숫자도 문자열로)', async () => {
    m.rpc.mockResolvedValue([{ slot: 0, card: 1, delta: 5 }]);
    for (const [v, want] of [['W', 'W'], ['L', 'L'], [2, '2'], ['3', '3'], [0, '0']] as const) {
      const res = await call('/api/game/result', { body: { win: v }, token: await gameStaff('jks1') });
      expect(res.statusCode).toBe(200);
      expect(res.body.results).toEqual([{ slot: 0, card: 1, delta: 5 }]);
      expect(m.rpc).toHaveBeenLastCalledWith('set_result', { p_station: 'jks1', p_win: want });
    }
  });
  it('이상한 값은 400 BAD_RESULT이고 DB를 부르지 않는다', async () => {
    for (const v of [undefined, null, 'w', 'X', 4, -1, 1.5, '10', '', {}, []]) {
      const res = await call('/api/game/result', { body: { win: v }, token: await gameStaff() });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_RESULT');
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('DB 오류 BAD_RESULT, BAD_PHASE 전달', async () => {
    for (const code of ['BAD_RESULT', 'BAD_PHASE']) {
      m.rpc.mockRejectedValueOnce({ message: code });
      expect((await call('/api/game/result', { body: { win: 'W' }, token: await gameStaff() })).body.code).toBe(code);
    }
  });
});

describe('game/settle', () => {
  const own = () => { m.tables = { matches: { data: { station: 'hg21' }, error: null } }; };
  it('내 매치를 정산하고 결과를 돌려준다', async () => {
    own();
    m.rpc.mockResolvedValue([{ slot: 0, card: 1, delta: 4 }, { slot: 1, card: 2, delta: -2 }]);
    const res = await call('/api/game/settle', { body: { match_id: '12' }, token: await gameStaff('hg21') });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ match_id: 12, already: false });
    expect(res.body.results).toHaveLength(2);
    expect(m.rpc).toHaveBeenCalledWith('settle_match', { p_match_id: 12 });
  });
  it('이미 정산된 매치는 already: true', async () => {
    own();
    m.rpc.mockResolvedValue({ already: true });
    const res = await call('/api/game/settle', { body: { match_id: 12 }, token: await gameStaff() });
    expect(res.body).toMatchObject({ already: true, results: [] });
  });
  it('남의 스테이션 매치는 403, DB 함수 안 부름', async () => {
    own();
    const res = await call('/api/game/settle', { body: { match_id: 12 }, token: await gameStaff('stm1') });
    expect(res.statusCode).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('match_id가 이상하면 400', async () => {
    own();
    for (const v of [undefined, 0, -1, 'a', 1.5]) {
      expect((await call('/api/game/settle', { body: { match_id: v }, token: await gameStaff() })).statusCode).toBe(400);
    }
  });
  it('BALANCE_CHANGED, WINNER_GONE, BAD_PHASE 409 전달', async () => {
    own();
    for (const code of ['BALANCE_CHANGED', 'WINNER_GONE', 'BAD_PHASE']) {
      m.rpc.mockRejectedValueOnce({ message: code });
      const res = await call('/api/game/settle', { body: { match_id: 12 }, token: await gameStaff() });
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe(code);
    }
  });
});

describe('me/ack', () => {
  it('내 카드로 ack_result', async () => {
    m.tables = { cards: { data: { token_version: 3 }, error: null } };
    m.rpc.mockResolvedValue(null);
    const res = await call('/api/me/ack', { body: { card_id: 999 }, token: await partToken(47, 3) });
    expect(res.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('ack_result', { p_card_id: 47 });
  });
  it('토큰 없으면 401, 오래된 토큰은 STALE_TOKEN', async () => {
    m.tables = { cards: { data: { token_version: 5 }, error: null } };
    expect((await call('/api/me/ack', { body: {} })).statusCode).toBe(401);
    expect((await call('/api/me/ack', { body: {}, token: await partToken(47, 3) })).body.code).toBe('STALE_TOKEN');
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('game/state', () => {
  const full = () => {
    m.tables = {
      matches: { data: { id: 12, game: 'HALLIGALLI', vs: 'friends', phase: 'review', win: '1' }, error: null },
      match_slots: { data: [
        { slot: 1, card_id: 2, stage: 'ready', bet: 3, proposed_delta: -3, acked_at: null },
        { slot: 0, card_id: 1, stage: 'ready', bet: 3, proposed_delta: 3, acked_at: '2026-11-14T00:00:00Z' },
      ], error: null },
      cards: { data: [{ id: 1, mask_name: '가*나' }, { id: 2, mask_name: '다*라' }], error: null },
      card_balance: { data: [{ card_id: 1, balance: 10 }, { card_id: 2, balance: 7 }], error: null },
    };
  };
  const get = async (st: any = 'hg21') => call('/api/game/state', { method: 'GET', token: await gameStaff(st) });
  it('매치와 칸을 한 번에 준다 (칸 번호 순)', async () => {
    full();
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body.match).toEqual({ id: 12, game: 'HALLIGALLI', vs: 'friends', phase: 'review', win: '1' });
    expect(res.body.slots.map((s: any) => s.slot)).toEqual([0, 1]);
    expect(res.body.slots[0]).toEqual({
      slot: 0, card_id: 1, mask_name: '가*나', stage: 'ready', bet: 3, balance: 10, proposed_delta: 3, acked: true,
    });
    expect(res.body.slots[1].acked).toBe(false);
  });
  it('진행 중인 매치가 없으면 match: null', async () => {
    m.tables = { matches: { data: null, error: null } };
    const res = await get();
    expect(res.body).toEqual({ ok: true, match: null, slots: [] });
  });
  it('이름은 가린 이름만 (원문 이름·암호문 없음)', async () => {
    full();
    expect(JSON.stringify((await get()).body)).not.toMatch(/name_enc|sid|uid|secret/i);
  });
  it('POST는 405, 게임 스태프가 아니면 403', async () => {
    full();
    expect((await call('/api/game/state', { method: 'POST', token: await gameStaff() })).statusCode).toBe(405);
    expect((await get('suc1')).statusCode).toBe(403);
  });
  it('DB 오류는 500이고 원문을 숨긴다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    full();
    (m.tables as any).match_slots = { data: null, error: { message: 'conn 10.0.0.5 refused' } };
    const res = await get();
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });
});
