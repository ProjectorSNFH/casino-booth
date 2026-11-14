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
const setCards = (tv = 3) => { m.tables = { cards: { data: { token_version: tv }, error: null }, matches: { data: { station: 'hg21' }, error: null } }; };

describe('game/scan', () => {
  it('내 스테이션 코드로 scan_card를 부른다 (몸에 station을 넣어도 무시)', async () => {
    m.rpc.mockResolvedValue({ match_id: '12', slot: 1 });
    const res = await call('/api/game/scan', { body: { card_id: '047', station: 'stm1' }, token: await gameStaff('hg21') });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ card_id: 47, match_id: 12, slot: 1 });
    expect(m.rpc).toHaveBeenCalledWith('scan_card', { p_station: 'hg21', p_card_id: 47 });
  });
  it('발급·상점 스태프는 403, 토큰 없으면 401', async () => {
    expect((await call('/api/game/scan', { body: { card_id: 1 }, token: await staffToken('suc1') })).statusCode).toBe(403);
    expect((await call('/api/game/scan', { body: { card_id: 1 } })).statusCode).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('식별번호가 틀리면 400', async () => {
    const res = await call('/api/game/scan', { body: { card_id: 'x' }, token: await gameStaff() });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BAD_CARD_ID');
  });
  it('DB 오류 코드 전달: LOW_COINS, PLAY_LIMIT, IN_MATCH, MATCH_FULL 모두 409', async () => {
    for (const code of ['LOW_COINS', 'PLAY_LIMIT', 'IN_MATCH', 'MATCH_FULL', 'PENDING_ORDER', 'MATCH_STARTED']) {
      m.rpc.mockRejectedValueOnce({ message: code });
      const res = await call('/api/game/scan', { body: { card_id: 5 }, token: await gameStaff() });
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe(code);
    }
    m.rpc.mockRejectedValueOnce({ message: 'NOT_ACTIVE' });
    expect((await call('/api/game/scan', { body: { card_id: 5 }, token: await gameStaff() })).body.code).toBe('NOT_ACTIVE');
  });
});

describe('game/scan: QR(uid)', () => {
  const UID = '0123456789ABCDEF'.replace(/[IL]/g, '1');
  it('uid로 카드를 찾아 scan_card에 번호를 넘긴다 (소문자도 허용)', async () => {
    m.tables = { cards: { data: { id: 47 }, error: null } };
    m.rpc.mockResolvedValue({ match_id: 12, slot: 0 });
    const res = await call('/api/game/scan', { body: { uid: UID.toLowerCase() }, token: await gameStaff() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ card_id: 47, slot: 0 });
    expect(m.rpc).toHaveBeenCalledWith('scan_card', { p_station: 'hg21', p_card_id: 47 });
  });
  it('모르는 uid는 404 NOT_FOUND, DB 함수를 부르지 않는다', async () => {
    m.tables = { cards: { data: null, error: null } };
    const res = await call('/api/game/scan', { body: { uid: UID }, token: await gameStaff() });
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('모양이 틀린 uid(길이, 금지 글자)는 404 NOT_FOUND, 조회도 안 함', async () => {
    for (const bad of ['ABC', 'IIIIIIIIIIIIIIII', 'OOOOOOOOOOOOOOOO', 123, '0123456789ABCDEFG']) {
      const res = await call('/api/game/scan', { body: { uid: bad }, token: await gameStaff() });
      expect(res.body.code).toBe('NOT_FOUND');
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('game/accept, reject', () => {
  it('내 스테이션 매치면 실행한다', async () => {
    setCards();
    m.rpc.mockResolvedValue(null);
    const a = await call('/api/game/accept', { body: { match_id: '12', slot: 0 }, token: await gameStaff('hg21') });
    expect(a.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('accept_slot', { p_match_id: 12, p_slot: 0 });
    const r = await call('/api/game/reject', { body: { match_id: 12, slot: '2' }, token: await gameStaff('hg21') });
    expect(r.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('reject_slot', { p_match_id: 12, p_slot: 2 });
  });
  it('다른 스테이션의 매치는 403이고 DB 함수를 부르지 않는다', async () => {
    setCards();
    const res = await call('/api/game/accept', { body: { match_id: 12, slot: 0 }, token: await gameStaff('stm1') });
    expect(res.statusCode).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('없는 매치는 404 NO_MATCH', async () => {
    m.tables = { matches: { data: null, error: null } };
    const res = await call('/api/game/reject', { body: { match_id: 99, slot: 0 }, token: await gameStaff() });
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('NO_MATCH');
  });
  it('형식이 틀리면 400', async () => {
    setCards();
    for (const b of [{}, { match_id: 0, slot: 0 }, { match_id: 1 }, { match_id: 1, slot: -1 }, { match_id: 1, slot: 1.5 }, { match_id: 'a', slot: 0 }]) {
      expect((await call('/api/game/accept', { body: b, token: await gameStaff() })).statusCode).toBe(400);
    }
  });
  it('BET_NOT_SET, BET_OVER_BALANCE 전달', async () => {
    setCards();
    for (const code of ['BET_NOT_SET', 'BET_OVER_BALANCE', 'MATCH_STARTED']) {
      m.rpc.mockRejectedValueOnce({ message: code });
      const res = await call('/api/game/accept', { body: { match_id: 12, slot: 0 }, token: await gameStaff() });
      expect(res.body.code).toBe(code);
    }
  });
});

describe('me/bet, me/leave', () => {
  it('내 카드로 베팅한다 (몸에 card_id를 넣어도 무시)', async () => {
    setCards();
    m.rpc.mockResolvedValue(null);
    const res = await call('/api/me/bet', { body: { bet: 3, card_id: 999 }, token: await partToken(47, 3) });
    expect(res.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('set_bet', { p_card_id: 47, p_bet: 3 });
  });
  it('베팅 값이 이상하면 400 BAD_BET, DB 안 부름', async () => {
    setCards();
    for (const bet of [0, -1, 1.5, 'x', null, undefined, 1e12]) {
      const res = await call('/api/me/bet', { body: { bet }, token: await partToken() });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_BET');
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('다른 기기가 재연결했으면 STALE_TOKEN 401', async () => {
    setCards(4);
    const res = await call('/api/me/bet', { body: { bet: 1 }, token: await partToken(47, 3) });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('STALE_TOKEN');
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('스태프 토큰, 토큰 없음, 없는 카드는 401', async () => {
    setCards();
    expect((await call('/api/me/bet', { body: { bet: 1 }, token: await staffToken('suc1') })).statusCode).toBe(401);
    expect((await call('/api/me/bet', { body: { bet: 1 } })).statusCode).toBe(401);
    m.tables = { cards: { data: null, error: null } };
    expect((await call('/api/me/bet', { body: { bet: 1 }, token: await partToken() })).statusCode).toBe(401);
  });
  it('DB 오류 BAD_BET, ALREADY_READY, NOT_IN_MATCH 전달', async () => {
    setCards();
    const want: Record<string, number> = { BAD_BET: 400, ALREADY_READY: 409, NOT_IN_MATCH: 404, NO_BET_GAME: 409 };
    for (const [code, st] of Object.entries(want)) {
      m.rpc.mockRejectedValueOnce({ message: code });
      const res = await call('/api/me/bet', { body: { bet: 2 }, token: await partToken() });
      expect(res.statusCode).toBe(st);
    }
  });
  it('leave: 내 카드로 leave_slot', async () => {
    setCards();
    m.rpc.mockResolvedValue(null);
    const res = await call('/api/me/leave', { body: {}, token: await partToken(47, 3) });
    expect(res.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('leave_slot', { p_card_id: 47 });
  });
  it('leave: 준비 완료 후엔 ALREADY_READY 409', async () => {
    setCards();
    m.rpc.mockRejectedValue({ message: 'ALREADY_READY' });
    expect((await call('/api/me/leave', { body: {}, token: await partToken() })).statusCode).toBe(409);
  });
});
