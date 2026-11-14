import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signAccess } from '../lib/auth';

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
      select: () => o, order: () => o, eq: () => o, in: () => o,
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
});

describe('권한: suc2 전용 / slt1 전용', () => {
  it('suc2가 아니면 403, 토큰 없으면 401, 쓰기는 일어나지 않는다', async () => {
    const paths = ['card', 'tlist-add', 'tlist-edit', 'tlist-delete', 'glist-set'];
    for (const p of paths) {
      for (const st of ['suc1', 'hg21', 'shp1', 'slt1']) {
        expect((await call('/api/adjust/' + p, { body: { card_id: 1 }, token: await staffToken(st) })).statusCode).toBe(403);
      }
      expect((await call('/api/adjust/' + p, { body: { card_id: 1 } })).statusCode).toBe(401);
    }
    expect(m.calls).toHaveLength(0);
  });
  it('event/slot은 slt1만', async () => {
    for (const st of ['suc2', 'hg21', 'suc1']) {
      expect((await call('/api/event/slot', { body: { card_id: 1, reward: 2 }, token: await staffToken(st) })).statusCode).toBe(403);
    }
    expect((await call('/api/event/slot', { body: { card_id: 1, reward: 2 } })).statusCode).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('adjust/card', () => {
  const seed = () => {
    m.tables = {
      cards: ok({ id: 7, mask_name: '홍*동', status: 'active' }),
      tlist: ok([
        { id: 1, at: 'a', content: 'WELCOME', coin_delta: 5, kind: 'WELCOME' },
        { id: 2, at: 'b', content: 'WIN', coin_delta: 8, kind: 'RESULT' },
        { id: 3, at: 'c', content: 'LOSE', coin_delta: -10, kind: 'RESULT' },
      ]),
      glist: ok([{ game: 'JOKER', n: 2 }]),
    };
  };
  it('기록, 누적, 잔고, 최대 보유치를 계산해서 준다', async () => {
    seed();
    const res = await call('/api/adjust/card', { body: { card_id: '007' }, token: await staffToken('suc2') });
    expect(res.statusCode).toBe(200);
    expect(res.body.card).toEqual({ id: 7, mask_name: '홍*동', status: 'active' });
    expect(res.body.balance).toBe(3);
    expect(res.body.peak).toBe(13);
    expect(res.body.tlist.map((r: any) => r.running)).toEqual([5, 13, 3]);
    expect(res.body.glist).toEqual([{ game: 'JOKER', n: 2 }]);
  });
  it('이름 원문, 학번, 암호문은 나가지 않는다', async () => {
    seed();
    const res = await call('/api/adjust/card', { body: { card_id: 7 }, token: await staffToken('suc2') });
    expect(JSON.stringify(res.body)).not.toMatch(/name_enc|sid|uid|secret|token_version/i);
  });
  it('기록이 없는 카드는 잔고와 최대 보유치가 0', async () => {
    seed();
    m.tables.tlist = ok([]);
    const res = await call('/api/adjust/card', { body: { card_id: 7 }, token: await staffToken('suc2') });
    expect(res.body).toMatchObject({ balance: 0, peak: 0, tlist: [] });
  });
  it('최대 보유치는 처음부터 음수인 경우에도 맞다', async () => {
    seed();
    m.tables.tlist = ok([{ id: 1, at: 'a', content: 'x', coin_delta: -3, kind: 'ADJUST' }]);
    const res = await call('/api/adjust/card', { body: { card_id: 7 }, token: await staffToken('suc2') });
    expect(res.body.peak).toBe(-3);
  });
  it('없는 카드는 404, 번호 형식이 틀리면 400', async () => {
    seed();
    m.tables.cards = ok(null);
    expect((await call('/api/adjust/card', { body: { card_id: 7 }, token: await staffToken('suc2') })).statusCode).toBe(404);
    expect((await call('/api/adjust/card', { body: { card_id: 'x' }, token: await staffToken('suc2') })).statusCode).toBe(400);
  });
});

describe('adjust/tlist-add', () => {
  const t = () => staffToken('suc2');
  it('ADJUST 기록을 추가한다 (사유 앞에 ADJUST를 붙임)', async () => {
    m.tables = { cards: ok({ id: 7 }), card_balance: ok({ balance: 10 }), tlist: ok([{ id: 99 }]) };
    const res = await call('/api/adjust/tlist-add', { body: { card_id: 7, delta: -4, reason: '  할리갈리   승자 반대 ' }, token: await t() });
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(99);
    expect(writes()).toEqual([{ table: 'tlist', op: 'insert', arg: { card_id: 7, content: 'ADJUST 할리갈리 승자 반대', coin_delta: -4, kind: 'ADJUST' } }]);
  });
  it('잔고보다 크게 깎으면 BALANCE_LOW 409, 쓰기 없음', async () => {
    m.tables = { cards: ok({ id: 7 }), card_balance: ok({ balance: 3 }), tlist: ok([{ id: 99 }]) };
    const res = await call('/api/adjust/tlist-add', { body: { card_id: 7, delta: -4, reason: 'x' }, token: await t() });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('BALANCE_LOW');
    expect(writes()).toHaveLength(0);
  });
  it('줄바꿈은 공백 하나로 정리된다', async () => {
    m.tables = { cards: ok({ id: 7 }), card_balance: ok({ balance: 10 }), tlist: ok([{ id: 1 }]) };
    await call('/api/adjust/tlist-add', { body: { card_id: 7, delta: 1, reason: 'a\nb' }, token: await staffToken('suc2') });
    expect((writes()[0].arg as any).content).toBe('ADJUST a b');
  });
  it('값이 이상하면 400이고 쓰기 없음', async () => {
    m.tables = { cards: ok({ id: 7 }), card_balance: ok({ balance: 10 }), tlist: ok([{ id: 1 }]) };
    const bad = [
      { card_id: 7, delta: 1.5, reason: 'x' }, { card_id: 7, delta: 1001, reason: 'x' }, { card_id: 7, delta: 'a', reason: 'x' },
      { card_id: 7, reason: 'x' }, { card_id: 7, delta: 1 }, { card_id: 7, delta: 1, reason: '   ' },
      { card_id: 7, delta: 1, reason: 'x'.repeat(61) }, { card_id: 7, delta: 1, reason: 'a\u0007b' }, { delta: 1, reason: 'x' },
    ];
    for (const body of bad) expect((await call('/api/adjust/tlist-add', { body, token: await t() })).statusCode).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  it('없는 카드는 404', async () => {
    m.tables = { cards: ok(null) };
    expect((await call('/api/adjust/tlist-add', { body: { card_id: 7, delta: 1, reason: 'x' }, token: await t() })).statusCode).toBe(404);
    expect(writes()).toHaveLength(0);
  });
  it('DB 오류는 500이고 원문을 숨긴다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.tables = { cards: ok({ id: 7 }), card_balance: ok({ balance: 10 }), tlist: { data: null, error: { message: 'secret host 10.1.2.3' } } };
    const res = await call('/api/adjust/tlist-add', { body: { card_id: 7, delta: 1, reason: 'x' }, token: await t() });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('10.1.2.3');
  });
});

describe('adjust/tlist-edit', () => {
  const t = () => staffToken('suc2');
  const seed = (bal = 10, oldDelta = 4) => {
    m.tables = {
      tlist: [ok({ id: 5, card_id: 7, coin_delta: oldDelta }), ok([{ id: 5 }])],
      card_balance: ok({ balance: bal }),
    };
  };
  it('변화량을 고친다 (잔고 = 현재 - 옛값 + 새값)', async () => {
    seed(10, 4);
    const res = await call('/api/adjust/tlist-edit', { body: { id: '5', coin_delta: -6 }, token: await t() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: 5, card_id: 7, coin_delta: -6 });
    expect(writes()).toEqual([{ table: 'tlist', op: 'update', arg: { coin_delta: -6 } }]);
  });
  it('고친 뒤 잔고가 음수가 되면 거부', async () => {
    seed(10, 4); // 10 - 4 + (-7) = -1
    const res = await call('/api/adjust/tlist-edit', { body: { id: 5, coin_delta: -7 }, token: await t() });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('BALANCE_LOW');
    expect(writes()).toHaveLength(0);
  });
  it('딱 0이 되는 것은 허용', async () => {
    seed(10, 4); // 10 - 4 + (-6) = 0
    expect((await call('/api/adjust/tlist-edit', { body: { id: 5, coin_delta: -6 }, token: await t() })).statusCode).toBe(200);
  });
  it('내용만 고치면 잔고를 따지지 않는다', async () => {
    m.tables = { tlist: [ok({ id: 5, card_id: 7, coin_delta: 4 }), ok([{ id: 5 }])] };
    const res = await call('/api/adjust/tlist-edit', { body: { id: 5, content: ' ADJUST  오타 수정 ' }, token: await t() });
    expect(res.statusCode).toBe(200);
    expect(writes()).toEqual([{ table: 'tlist', op: 'update', arg: { content: 'ADJUST 오타 수정' } }]);
  });
  it('고칠 값이 없거나 이상하면 400', async () => {
    seed();
    for (const body of [{ id: 5 }, { id: 0, coin_delta: 1 }, { id: 5, coin_delta: 2000 }, { id: 5, content: '' }, { id: 5, content: 'x'.repeat(121) }, { coin_delta: 1 }]) {
      expect((await call('/api/adjust/tlist-edit', { body, token: await t() })).statusCode).toBe(400);
    }
    expect(writes()).toHaveLength(0);
  });
  it('없는 기록은 404', async () => {
    m.tables = { tlist: ok(null) };
    expect((await call('/api/adjust/tlist-edit', { body: { id: 5, coin_delta: 1 }, token: await t() })).statusCode).toBe(404);
  });
  it('card_id나 kind는 바꿀 수 없다 (보내도 무시)', async () => {
    seed();
    await call('/api/adjust/tlist-edit', { body: { id: 5, coin_delta: 1, card_id: 9, kind: 'WELCOME', match_id: 3 }, token: await t() });
    expect(writes()[0].arg).toEqual({ coin_delta: 1 });
  });
});

describe('adjust/tlist-delete', () => {
  const t = () => staffToken('suc2');
  it('기록을 지운다', async () => {
    m.tables = { tlist: [ok({ id: 5, card_id: 7, coin_delta: 4 }), ok([{ id: 5 }])], card_balance: ok({ balance: 10 }) };
    const res = await call('/api/adjust/tlist-delete', { body: { id: 5 }, token: await t() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: 5, card_id: 7 });
    expect(writes()).toEqual([{ table: 'tlist', op: 'delete' }]);
  });
  it('지우면 잔고가 음수가 되는 기록은 거부', async () => {
    m.tables = { tlist: [ok({ id: 5, card_id: 7, coin_delta: 8 }), ok([{ id: 5 }])], card_balance: ok({ balance: 5 }) };
    const res = await call('/api/adjust/tlist-delete', { body: { id: 5 }, token: await t() });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('BALANCE_LOW');
    expect(writes()).toHaveLength(0);
  });
  it('음수 기록(손실)을 지워 잔고가 늘어나는 것은 허용', async () => {
    m.tables = { tlist: [ok({ id: 5, card_id: 7, coin_delta: -6 }), ok([{ id: 5 }])], card_balance: ok({ balance: 0 }) };
    expect((await call('/api/adjust/tlist-delete', { body: { id: 5 }, token: await t() })).statusCode).toBe(200);
  });
  it('없는 기록은 404, 번호가 이상하면 400', async () => {
    m.tables = { tlist: ok(null) };
    expect((await call('/api/adjust/tlist-delete', { body: { id: 5 }, token: await t() })).statusCode).toBe(404);
    for (const id of [undefined, 0, -1, 'a', 1.5]) {
      expect((await call('/api/adjust/tlist-delete', { body: { id }, token: await t() })).statusCode).toBe(400);
    }
    expect(writes()).toHaveLength(0);
  });
  it('동시에 이미 지워졌으면 404', async () => {
    m.tables = { tlist: [ok({ id: 5, card_id: 7, coin_delta: 1 }), ok([])], card_balance: ok({ balance: 10 }) };
    expect((await call('/api/adjust/tlist-delete', { body: { id: 5 }, token: await t() })).statusCode).toBe(404);
  });
});

describe('adjust/glist-set', () => {
  const t = () => staffToken('suc2');
  it('게임 참여 횟수를 값으로 지정한다 (upsert)', async () => {
    m.tables = { cards: ok({ id: 7 }), glist: ok([{ card_id: 7 }]) };
    const res = await call('/api/adjust/glist-set', { body: { card_id: 7, game: 'JOKER', n: '3' }, token: await t() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ card_id: 7, game: 'JOKER', n: 3 });
    const w = writes()[0];
    expect(w.op).toBe('upsert');
    expect(w.arg).toMatchObject({ card_id: 7, game: 'JOKER', n: 3 });
    expect(w.opt).toEqual({ onConflict: 'card_id,game' });
  });
  it('0도 허용', async () => {
    m.tables = { cards: ok({ id: 7 }), glist: ok([{ card_id: 7 }]) };
    expect((await call('/api/adjust/glist-set', { body: { card_id: 7, game: 'SKEWER', n: 0 }, token: await t() })).statusCode).toBe(200);
  });
  it('모르는 게임, 음수, 큰 수, 소수는 400 (슬롯 머신 횟수도 못 바꿈)', async () => {
    m.tables = { cards: ok({ id: 7 }), glist: ok([{ card_id: 7 }]) };
    for (const b of [
      { game: 'POKER', n: 1 }, { game: 'SLOTMACHINE', n: 1 }, { game: 'JOKER', n: -1 }, { game: 'JOKER', n: 100 },
      { game: 'JOKER', n: 1.5 }, { game: 'JOKER' }, { n: 1 }, { game: 'joker', n: 1 },
    ]) {
      expect((await call('/api/adjust/glist-set', { body: { card_id: 7, ...b }, token: await t() })).statusCode).toBe(400);
    }
    expect(writes()).toHaveLength(0);
  });
  it('없는 카드는 404', async () => {
    m.tables = { cards: ok(null) };
    expect((await call('/api/adjust/glist-set', { body: { card_id: 7, game: 'JOKER', n: 1 }, token: await t() })).statusCode).toBe(404);
    expect(writes()).toHaveLength(0);
  });
});

describe('event/slot', () => {
  const t = () => staffToken('slt1');
  it('slot_event를 부르고 잔고를 돌려준다', async () => {
    m.rpc.mockResolvedValue({ reward: 6, balance: 11 });
    const res = await call('/api/event/slot', { body: { card_id: '001', reward: '6' }, token: await t() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ card_id: 1, reward: 6, balance: 11, already: false });
    expect(m.rpc).toHaveBeenCalledWith('slot_event', { p_card_id: 1, p_reward: 6 });
  });
  it('같은 값을 다시 보내면 already: true', async () => {
    m.rpc.mockResolvedValue({ already: true, reward: 6, balance: 11 });
    const res = await call('/api/event/slot', { body: { card_id: 1, reward: 6 }, token: await t() });
    expect(res.body.already).toBe(true);
  });
  it('금액이 숫자가 아니면 400 BAD_REWARD, DB 안 부름', async () => {
    for (const reward of [undefined, null, 'x', 1.5, {}, [], -1, '123', 100]) {
      const res = await call('/api/event/slot', { body: { card_id: 1, reward }, token: await t() });
      expect(res.statusCode).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('DB가 빈 응답을 주면 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.rpc.mockResolvedValue(null);
    expect((await call('/api/event/slot', { body: { card_id: 1, reward: 2 }, token: await t() })).statusCode).toBe(500);
  });
  it('식별번호가 틀리면 400 BAD_CARD_ID', async () => {
    const res = await call('/api/event/slot', { body: { card_id: 'x', reward: 2 }, token: await t() });
    expect(res.body.code).toBe('BAD_CARD_ID');
  });
  it('DB 오류 전달: BAD_REWARD 400, ALREADY_PLAYED 409, NOT_ACTIVE 409, NOT_FOUND 404', async () => {
    const want: Array<[string, number]> = [['BAD_REWARD', 400], ['ALREADY_PLAYED', 409], ['NOT_ACTIVE', 409], ['NOT_FOUND', 404]];
    for (const [code, st] of want) {
      m.rpc.mockRejectedValueOnce({ message: code });
      const res = await call('/api/event/slot', { body: { card_id: 1, reward: 5 }, token: await t() });
      expect(res.statusCode).toBe(st);
      expect(res.body.code).toBe(code);
    }
  });
});
