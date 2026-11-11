import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/errors';
import { clearLimit, enforceLimit, rateLimit, rpc } from '../lib/db';

function fakeRedis() {
  const store = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    store,
    ttls,
    incr: vi.fn(async (k: string) => {
      const n = (store.get(k) ?? 0) + 1;
      store.set(k, n);
      return n;
    }),
    expire: vi.fn(async (k: string, s: number) => {
      ttls.set(k, s);
      return 1;
    }),
    ttl: vi.fn(async (k: string) => ttls.get(k) ?? -1),
    del: vi.fn(async (k: string) => {
      const had = store.delete(k);
      ttls.delete(k);
      return had ? 1 : 0;
    }),
  };
}

describe('rpc', () => {
  it('성공하면 data를 돌려준다', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: 7, error: null }) };
    expect(await rpc<number>('issue_card', { p_part: 1 }, client as never)).toBe(7);
    expect(client.rpc).toHaveBeenCalledWith('issue_card', { p_part: 1 });
  });
  it('DB 오류 코드를 ApiError로 바꾼다', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'PART_ENDED', details: null } }) };
    await expect(rpc('issue_card', {}, client as never)).rejects.toMatchObject({
      code: 'PART_ENDED',
      status: 409,
    });
  });
  it('SOLD_OUT은 상세를 유지한다', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'SOLD_OUT', details: '마카로니' } }) };
    await expect(rpc('create_order', {}, client as never)).rejects.toMatchObject({
      code: 'SOLD_OUT',
      detail: '마카로니',
    });
  });
  it('모르는 오류는 INTERNAL', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'syntax error at or near "x"' } }) };
    await expect(rpc('x', {}, client as never)).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

describe('rateLimit', () => {
  it('첫 호출에서 만료 시간을 건다', async () => {
    const r = fakeRedis();
    await rateLimit('pin:a', 3, 60, r as never);
    expect(r.expire).toHaveBeenCalledTimes(1);
    expect(r.expire).toHaveBeenCalledWith('rl:pin:a', 60);
  });
  it('한도까지는 통과한다', async () => {
    const r = fakeRedis();
    for (let i = 1; i <= 3; i++) {
      const l = await rateLimit('pin:a', 3, 60, r as never);
      expect(l).toEqual({ ok: true, count: i, retryAfter: 0 });
    }
  });
  it('한도를 넘으면 막고 남은 시간을 알려 준다', async () => {
    const r = fakeRedis();
    for (let i = 0; i < 3; i++) await rateLimit('pin:a', 3, 60, r as never);
    expect(await rateLimit('pin:a', 3, 60, r as never)).toEqual({ ok: false, count: 4, retryAfter: 60 });
  });
  it('키마다 따로 센다', async () => {
    const r = fakeRedis();
    for (let i = 0; i < 4; i++) await rateLimit('pin:a', 3, 60, r as never);
    expect((await rateLimit('pin:b', 3, 60, r as never)).ok).toBe(true);
  });
  it('만료가 없는 카운터는 만료를 다시 건다 (영구 잠금 방지)', async () => {
    const r = fakeRedis();
    r.store.set('rl:x', 5);
    const l = await rateLimit('x', 3, 60, r as never);
    expect(l).toEqual({ ok: false, count: 6, retryAfter: 60 });
    expect(r.ttls.get('rl:x')).toBe(60);
  });
});

describe('enforceLimit', () => {
  it('한도 안이면 조용히 통과', async () => {
    const r = fakeRedis();
    await expect(enforceLimit('k', 2, 60, r as never)).resolves.toBeUndefined();
  });
  it('한도를 넘으면 RATE_LIMITED 429', async () => {
    const r = fakeRedis();
    await enforceLimit('k', 1, 60, r as never);
    await expect(enforceLimit('k', 1, 60, r as never)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    await expect(enforceLimit('k', 1, 60, r as never)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('clearLimit', () => {
  it('비우면 다시 처음부터 센다', async () => {
    const r = fakeRedis();
    for (let i = 0; i < 4; i++) await rateLimit('k', 3, 60, r as never);
    await clearLimit('k', r as never);
    expect(await rateLimit('k', 3, 60, r as never)).toEqual({ ok: true, count: 1, retryAfter: 0 });
  });
});