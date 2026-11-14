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
      select: () => o, update: () => o, order: () => o, eq: () => o, in: () => o, is: () => o,
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





const shopToken = (st: any) => staffToken(st);
const partToken = async (card_id = 47, tv = 3) => (await signAccess({ kind: 'participant', card_id, tv })).token;
const ok = (extra: Record<string, unknown> = {}) => {
  m.tables = { cards: { data: { token_version: 3 }, error: null }, ...extra };
};

describe('shop/order', () => {
  it('상품 id와 수량만 DB로 보낸다 (금액은 무시)', async () => {
    ok();
    m.rpc.mockResolvedValue('55');
    const res = await call('/api/shop/order', {
      body: { items: [{ id: '2', qty: 3, price: 1 }, { id: 4, qty: 1 }], total: 1 },
      token: await partToken(47, 3),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.order_id).toBe(55);
    expect(m.rpc).toHaveBeenCalledWith('create_order', { p_card_id: 47, p_items: [{ id: 2, qty: 3 }, { id: 4, qty: 1 }] });
  });
  it('상품이 이상하면 400 BAD_ITEMS이고 DB를 부르지 않는다', async () => {
    ok();
    const bad: unknown[] = [
      undefined, null, [], 'x', {}, [{}], [{ id: 1 }], [{ qty: 1 }], [{ id: 0, qty: 1 }], [{ id: 1, qty: 0 }],
      [{ id: 1, qty: 100 }], [{ id: 1.5, qty: 1 }], [{ id: 'a', qty: 1 }], [null], [1],
      Array.from({ length: 21 }, () => ({ id: 1, qty: 1 })),
    ];
    for (const items of bad) {
      const res = await call('/api/shop/order', { body: { items }, token: await partToken() });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_ITEMS');
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('토큰 없으면 401, 스태프 토큰도 401, 오래된 토큰은 STALE_TOKEN', async () => {
    ok();
    const body = { items: [{ id: 1, qty: 1 }] };
    expect((await call('/api/shop/order', { body })).statusCode).toBe(401);
    expect((await call('/api/shop/order', { body, token: await shopToken('shp1') })).statusCode).toBe(401);
    expect((await call('/api/shop/order', { body, token: await partToken(47, 2) })).body.code).toBe('STALE_TOKEN');
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('DB 오류 전달 + SOLD_OUT은 상품 이름(detail)까지', async () => {
    ok();
    const body = { items: [{ id: 1, qty: 1 }] };
    for (const code of ['NOT_ENOUGH_PLAYS', 'OVER_BALANCE', 'IN_MATCH', 'NOT_ACTIVE']) {
      m.rpc.mockRejectedValueOnce({ message: code });
      const res = await call('/api/shop/order', { body, token: await partToken() });
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe(code);
    }
    m.rpc.mockRejectedValueOnce({ message: 'SOLD_OUT', details: '초코파이' });
    const so = await call('/api/shop/order', { body, token: await partToken() });
    expect(so.statusCode).toBe(409);
    expect(so.body.detail).toBe('초코파이');
  });
});

describe('shop/cancel, shop/products', () => {
  it('취소는 내 카드로 cancel_order', async () => {
    ok();
    m.rpc.mockResolvedValue(null);
    const res = await call('/api/shop/cancel', { body: { card_id: 1 }, token: await partToken(47, 3) });
    expect(res.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('cancel_order', { p_card_id: 47 });
  });
  it('상품 목록은 참여자 토큰이 필요하다', async () => {
    ok({ products: { data: [{ id: 1, name: '마카로니', price: 7, status: 'on_sale' }], error: null } });
    expect((await call('/api/shop/products', { method: 'GET' })).statusCode).toBe(401);
    const res = await call('/api/shop/products', { method: 'GET', token: await partToken() });
    expect(res.statusCode).toBe(200);
    expect(res.body.products).toEqual([{ id: 1, name: '마카로니', price: 7, status: 'on_sale' }]);
    expect((await call('/api/shop/products', { method: 'POST', token: await partToken() })).statusCode).toBe(405);
  });
});

describe('shop/approve, reject, deliver', () => {
  it('승인: shp1만, 결과(총액, 잔고)를 돌려준다', async () => {
    m.rpc.mockResolvedValue({ order_id: 9, total: 14, balance: 28 });
    const res = await call('/api/shop/approve', { body: { order_id: '9' }, token: await shopToken('shp1') });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ order_id: 9, total: 14, balance: 28 });
    expect(m.rpc).toHaveBeenCalledWith('approve_order', { p_order_id: 9 });
  });
  it('이미 승인된 주문을 다시 보내도 오류 없이 already', async () => {
    m.rpc.mockResolvedValue({ already: true, order_id: 9 });
    const res = await call('/api/shop/approve', { body: { order_id: 9 }, token: await shopToken('shp1') });
    expect(res.body.already).toBe(true);
  });
  it('거절은 shp1, 배부는 shp2만', async () => {
    m.rpc.mockResolvedValue(null);
    expect((await call('/api/shop/reject', { body: { order_id: 3 }, token: await shopToken('shp1') })).statusCode).toBe(200);
    expect(m.rpc).toHaveBeenLastCalledWith('reject_order', { p_order_id: 3 });
    expect((await call('/api/shop/deliver', { body: { order_id: 3 }, token: await shopToken('shp2') })).statusCode).toBe(200);
    expect(m.rpc).toHaveBeenLastCalledWith('deliver_order', { p_order_id: 3 });
  });
  it('역할이 다르면 403 (shp2는 승인 못 함, shp1은 배부 못 함, 게임 스태프도 못 함)', async () => {
    for (const [p, st] of [['approve', 'shp2'], ['reject', 'shp2'], ['deliver', 'shp1'], ['approve', 'hg21'], ['deliver', 'suc2']] as const) {
      expect((await call('/api/shop/' + p, { body: { order_id: 1 }, token: await shopToken(st) })).statusCode).toBe(403);
    }
    for (const p of ['approve', 'reject', 'deliver']) {
      expect((await call('/api/shop/' + p, { body: { order_id: 1 } })).statusCode).toBe(401);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('order_id가 이상하면 400', async () => {
    for (const v of [undefined, 0, -1, 'a', 1.5]) {
      expect((await call('/api/shop/approve', { body: { order_id: v }, token: await shopToken('shp1') })).statusCode).toBe(400);
    }
  });
  it('DB 오류 전달: SOLD_OUT(detail), BALANCE_LOW, ORDER_CLOSED, NO_ORDER, NOT_APPROVED', async () => {
    m.rpc.mockRejectedValueOnce({ message: 'SOLD_OUT', details: '마카로니, 초코파이' });
    const so = await call('/api/shop/approve', { body: { order_id: 1 }, token: await shopToken('shp1') });
    expect(so.body.detail).toBe('마카로니, 초코파이');
    const want: Array<[string, string, number, string]> = [
      ['approve', 'BALANCE_LOW', 409, 'shp1'], ['approve', 'ORDER_CLOSED', 409, 'shp1'],
      ['approve', 'NO_ORDER', 404, 'shp1'], ['deliver', 'NOT_APPROVED', 409, 'shp2'],
    ];
    for (const [p, code, st, who] of want) {
      m.rpc.mockRejectedValueOnce({ message: code });
      const res = await call('/api/shop/' + p, { body: { order_id: 1 }, token: await shopToken(who) });
      expect(res.statusCode).toBe(st);
      expect(res.body.code).toBe(code);
    }
  });
});

describe('shop/stock', () => {
  it('shp1이 판매/품절을 바꾼다', async () => {
    m.tables = { products: { data: [{ id: 2 }], error: null } };
    const a = await call('/api/shop/stock', { body: { id: 2, status: 'sold_out' }, token: await shopToken('shp1') });
    expect(a.statusCode).toBe(200);
    expect(a.body).toMatchObject({ id: 2, status: 'sold_out' });
    const b = await call('/api/shop/stock', { body: { id: '2', status: 'on_sale' }, token: await shopToken('shp1') });
    expect(b.statusCode).toBe(200);
  });
  it('없는 상품은 400 BAD_ITEMS', async () => {
    m.tables = { products: { data: [], error: null } };
    const res = await call('/api/shop/stock', { body: { id: 99, status: 'sold_out' }, token: await shopToken('shp1') });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BAD_ITEMS');
  });
  it('값이 이상하면 400, 권한 없으면 403', async () => {
    m.tables = { products: { data: [{ id: 2 }], error: null } };
    for (const b of [{}, { id: 2 }, { id: 2, status: 'x' }, { id: 0, status: 'sold_out' }, { id: 2, status: 'sold' }]) {
      expect((await call('/api/shop/stock', { body: b, token: await shopToken('shp1') })).statusCode).toBe(400);
    }
    expect((await call('/api/shop/stock', { body: { id: 2, status: 'sold_out' }, token: await shopToken('shp2') })).statusCode).toBe(403);
    expect((await call('/api/shop/stock', { body: { id: 2, status: 'sold_out' } })).statusCode).toBe(401);
  });
});

describe('shop/orders, shop/queue', () => {
  it('shp1 대기 주문에 잔고를 붙이고 상품 재고도 준다', async () => {
    m.tables = {
      orders: { data: [{ id: 5, card_id: 1, items: [{ id: 1, name: '마카로니', qty: 2, price: 7 }], total: 14, created_at: 'x' }], error: null },
      products: { data: [{ id: 1, name: '마카로니', price: 7, status: 'on_sale' }], error: null },
      card_balance: { data: [{ card_id: 1, balance: 30 }], error: null },
    };
    const res = await call('/api/shop/orders', { method: 'GET', token: await shopToken('shp1') });
    expect(res.statusCode).toBe(200);
    expect(res.body.orders).toEqual([{ id: 5, card_id: 1, items: [{ id: 1, name: '마카로니', qty: 2, price: 7 }], total: 14, balance: 30 }]);
    expect(res.body.products).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/name_enc|sid|secret/i);
  });
  it('주문이 없으면 빈 목록', async () => {
    m.tables = { orders: { data: [], error: null }, products: { data: [], error: null } };
    const res = await call('/api/shop/orders', { method: 'GET', token: await shopToken('shp1') });
    expect(res.body.orders).toEqual([]);
  });
  it('shp2 배부 대기 목록', async () => {
    m.tables = { orders: { data: [{ id: 6, card_id: 2, items: [], total: 7, approved_at: 'x' }], error: null } };
    const res = await call('/api/shop/queue', { method: 'GET', token: await shopToken('shp2') });
    expect(res.statusCode).toBe(200);
    expect(res.body.orders).toEqual([{ id: 6, card_id: 2, items: [], total: 7 }]);
  });
  it('역할이 다르면 403, POST는 405', async () => {
    m.tables = { orders: { data: [], error: null }, products: { data: [], error: null } };
    expect((await call('/api/shop/orders', { method: 'GET', token: await shopToken('shp2') })).statusCode).toBe(403);
    expect((await call('/api/shop/queue', { method: 'GET', token: await shopToken('shp1') })).statusCode).toBe(403);
    expect((await call('/api/shop/queue', { method: 'POST', token: await shopToken('shp2') })).statusCode).toBe(405);
  });
});
