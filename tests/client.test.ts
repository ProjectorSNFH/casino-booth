import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// 브라우저용 스크립트를 그대로 읽어서 시험한다 (저장소 맨 위 폴더에서 npm test를 실행한다고 가정)
const mod: { exports: any } = { exports: {} };
new Function('module', readFileSync('public/js/casino-api.js', 'utf8'))(mod);
const { createClient } = mod.exports;

type Reply = { status: number; json: unknown } | 'network';
let replies: Reply[];
let calls: Array<{ url: string; method: string; auth?: string; body?: any }>;
let mem: Record<string, string>;
let clock: number;

const storage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => { mem[k] = String(v); },
  removeItem: (k: string) => { delete mem[k]; },
};
const fakeFetch = async (url: string, init: any) => {
  calls.push({
    url, method: init.method, auth: init.headers.authorization,
    body: init.body ? JSON.parse(init.body) : undefined,
  });
  const r = replies.shift();
  if (!r) throw new Error('예상 못한 요청: ' + url);
  if (r === 'network') throw new TypeError('failed');
  return { status: r.status, text: async () => (typeof r.json === 'string' ? r.json : JSON.stringify(r.json)) };
};
const make = () => createClient({ baseUrl: 'https://x.test/', fetch: fakeFetch, storage, now: () => clock });
const ok = (extra: object = {}) => ({ status: 200, json: { ok: true, ...extra } });
const err = (status: number, code: string, extra: object = {}) => ({ status, json: { ok: false, code, message: '메시지:' + code, ...extra } });
const tok = (t: string, exp = clock + 600) => ({ token: t, expiresAt: exp });
const putSession = (kind: 'staff' | 'me', over: object = {}) => {
  mem['casino.' + kind] = JSON.stringify({
    station: 'suc1', role: 'issue', card_id: 7, access: tok('A1'), refresh: tok('R1', clock + 9999), ...over,
  });
};

beforeEach(() => { replies = []; calls = []; mem = {}; clock = 1_000_000; });

describe('staffEnter', () => {
  it('토큰을 저장하고, 빈 PIN은 보내지 않는다', async () => {
    replies.push(ok({ station: 'suc1', role: 'issue', access: tok('A1'), refresh: tok('R1') }));
    const c = make();
    expect(await c.staffEnter('suc1', '')).toEqual({ station: 'suc1', role: 'issue' });
    expect(calls[0].url).toBe('https://x.test/api/staff/enter');
    expect(calls[0].body).toEqual({ code: 'suc1' });
    expect(calls[0].auth).toBeUndefined();
    expect(c.staffSession()).toEqual({ station: 'suc1', role: 'issue' });
    expect(JSON.parse(mem['casino.staff']).access.token).toBe('A1');
  });
  it('PIN이 있으면 보낸다', async () => {
    replies.push(ok({ station: 'suc2', role: 'adjust', access: tok('A'), refresh: tok('R') }));
    await make().staffEnter('suc2', '4821');
    expect(calls[0].body).toEqual({ code: 'suc2', pin: '4821' });
  });
  it('틀린 PIN은 CasinoError(code)로 던지고 저장하지 않는다', async () => {
    replies.push(err(401, 'WRONG_PIN'));
    await expect(make().staffEnter('suc2', '0')).rejects.toMatchObject({ name: 'CasinoError', status: 401, code: 'WRONG_PIN', message: '메시지:WRONG_PIN' });
    expect(mem['casino.staff']).toBeUndefined();
  });
});

describe('인증 요청', () => {
  it('Bearer 토큰을 붙이고, GET은 본문이 없다', async () => {
    putSession('staff');
    replies.push(ok({ cards: [] }));
    const r = await make().staff.issueCards();
    expect(r.cards).toEqual([]);
    expect(calls[0]).toMatchObject({ method: 'GET', auth: 'Bearer A1', url: 'https://x.test/api/issue/cards' });
    expect(calls[0].body).toBeUndefined();
  });
  it('POST 본문과 참여자 토큰', async () => {
    putSession('me');
    replies.push(ok());
    await make().me.bet({ bet: 3 });
    expect(calls[0]).toMatchObject({ method: 'POST', auth: 'Bearer A1', url: 'https://x.test/api/me/bet', body: { bet: 3 } });
  });
  it('스태프와 참여자 세션은 서로 섞이지 않는다', async () => {
    putSession('staff', { access: tok('STAFFTOK') });
    putSession('me', { access: tok('METOK') });
    replies.push(ok(), ok());
    const c = make();
    await c.staff.gameState();
    await c.me.leave();
    expect(calls[0].auth).toBe('Bearer STAFFTOK');
    expect(calls[1].auth).toBe('Bearer METOK');
  });
  it('세션이 없으면 요청 없이 UNAUTHORIZED', async () => {
    await expect(make().me.bet({ bet: 1 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(calls).toHaveLength(0);
  });
  it('서버 오류의 code, detail, status를 전달한다', async () => {
    putSession('me');
    replies.push(err(409, 'SOLD_OUT', { detail: '초코파이' }));
    await expect(make().me.order({ items: [] })).rejects.toMatchObject({ status: 409, code: 'SOLD_OUT', detail: '초코파이' });
  });
  it('JSON이 아닌 응답은 SERVER 오류', async () => {
    putSession('me');
    replies.push({ status: 502, json: 'Bad Gateway' });
    await expect(make().me.leave()).rejects.toMatchObject({ code: 'SERVER', status: 502 });
  });
  it('네트워크 실패는 NETWORK', async () => {
    putSession('me');
    replies.push('network');
    await expect(make().me.leave()).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });
});

describe('토큰 갱신', () => {
  it('만료 30초 전이면 먼저 갱신하고 새 토큰으로 요청한다', async () => {
    putSession('staff', { access: tok('OLD', clock + 10) });
    replies.push(ok({ access: tok('NEW') }), ok({ cards: [] }));
    await make().staff.issueCards();
    expect(calls[0]).toMatchObject({ url: 'https://x.test/api/auth/refresh', body: { refresh: 'R1' } });
    expect(calls[1].auth).toBe('Bearer NEW');
    expect(JSON.parse(mem['casino.staff']).access.token).toBe('NEW');
  });
  it('동시에 여러 요청이 와도 갱신은 한 번', async () => {
    putSession('me', { access: tok('OLD', clock - 5) });
    replies.push(ok({ access: tok('NEW') }), ok(), ok(), ok());
    const c = make();
    await Promise.all([c.me.leave(), c.me.ack(), c.me.leave()]);
    expect(calls.filter((x) => x.url.endsWith('auth/refresh'))).toHaveLength(1);
    expect(calls.filter((x) => x.auth === 'Bearer NEW')).toHaveLength(3);
  });
  it('서버가 UNAUTHORIZED를 주면 갱신 후 한 번만 다시 시도한다', async () => {
    putSession('staff');
    replies.push(err(401, 'UNAUTHORIZED'), ok({ access: tok('NEW') }), ok({ done: 1 }));
    const r = await make().staff.gameState();
    expect(r.done).toBe(1);
    expect(calls.map((x) => x.url.split('/api/')[1])).toEqual(['game/state', 'auth/refresh', 'game/state']);
    expect(calls[2].auth).toBe('Bearer NEW');
  });
  it('다시 시도해도 401이면 세션을 지우고 알린다 (무한 반복 없음)', async () => {
    putSession('staff');
    replies.push(err(401, 'UNAUTHORIZED'), ok({ access: tok('NEW') }), err(401, 'UNAUTHORIZED'));
    const c = make();
    const lost = vi.fn();
    c.onSessionLost(lost);
    await expect(c.staff.gameState()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(calls).toHaveLength(3);
    expect(lost).toHaveBeenCalledWith('staff', 'UNAUTHORIZED');
    expect(mem['casino.staff']).toBeUndefined();
  });
  it('갱신 자체가 거부되면 세션을 지우고 알린다', async () => {
    putSession('me', { access: tok('OLD', clock - 1) });
    replies.push(err(401, 'STALE_TOKEN'));
    const c = make();
    const lost = vi.fn();
    c.onSessionLost(lost);
    await expect(c.me.leave()).rejects.toMatchObject({ code: 'STALE_TOKEN' });
    expect(lost).toHaveBeenCalledWith('me', 'STALE_TOKEN');
    expect(mem['casino.me']).toBeUndefined();
  });
  it('다른 기기 재연결(STALE_TOKEN)은 바로 세션을 지우고 알린다', async () => {
    putSession('me');
    replies.push(err(401, 'STALE_TOKEN'));
    const c = make();
    const lost = vi.fn();
    c.onSessionLost(lost);
    await expect(c.me.bet({ bet: 1 })).rejects.toMatchObject({ code: 'STALE_TOKEN' });
    expect(calls).toHaveLength(1);
    expect(lost).toHaveBeenCalledWith('me', 'STALE_TOKEN');
    expect(mem['casino.me']).toBeUndefined();
  });
  it('네트워크 때문에 갱신이 실패하면 세션은 유지한다', async () => {
    putSession('me', { access: tok('OLD', clock - 1) });
    replies.push('network');
    await expect(make().me.leave()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(mem['casino.me']).toBeDefined();
  });
  it('권한 부족(403)은 세션을 지우지 않는다', async () => {
    putSession('staff');
    replies.push(err(403, 'FORBIDDEN'));
    const c = make();
    await expect(c.staff.adjustCard({ card_id: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(mem['casino.staff']).toBeDefined();
  });
});

describe('참여자 입장', () => {
  it('claim은 번호·세션명을 보내고 비밀을 돌려준다', async () => {
    replies.push(ok({ claim_id: 5, secret: 'S'.repeat(30), session_name: 'abcde', claimant: tok('C') }));
    const r = await make().claim(47, 'abcde');
    expect(calls[0].body).toEqual({ card_id: 47, session_name: 'abcde' });
    expect(r).toEqual({ claim_id: 5, secret: 'S'.repeat(30), session_name: 'abcde' });
  });
  it('재연결 요청은 학번·이름·세션명', async () => {
    replies.push(ok({ claim_id: 6, secret: 'T'.repeat(30), session_name: 'fghij' }));
    await make().reconnect('20231', '홍길동', 'fghij');
    expect(calls[0].url).toBe('https://x.test/api/entry/reconnect');
    expect(calls[0].body).toEqual({ sid: '20231', name: '홍길동', session_name: 'fghij' });
  });
  it('확정되면 참여자 토큰을 저장한다 (비밀은 요청에만 사용)', async () => {
    replies.push(ok({ status: 'confirmed', card_id: 47, access: tok('PA'), refresh: tok('PR') }));
    const c = make();
    expect(await c.claimStatus({ claim_id: 5, secret: 'S' })).toEqual({ status: 'confirmed', card_id: 47 });
    expect(c.meSession()).toEqual({ card_id: 47 });
    expect(mem['casino.me']).not.toContain('"S"');
  });
  it('대기 중이면 저장하지 않는다', async () => {
    replies.push(ok({ status: 'waiting' }));
    const c = make();
    expect(await c.claimStatus({ claim_id: 5, secret: 'S' })).toEqual({ status: 'waiting' });
    expect(c.meSession()).toBeNull();
  });
  it('waitClaim: 확정될 때까지 반복해서 확인한다', async () => {
    vi.useFakeTimers();
    replies.push(ok({ status: 'waiting' }), ok({ status: 'waiting' }), ok({ status: 'confirmed', card_id: 9, access: tok('A'), refresh: tok('R') }));
    const seen: string[] = [];
    const p = make().waitClaim({ claim_id: 1, secret: 'S' }, { every: 1000, onStatus: (s: any) => seen.push(s.status) });
    await vi.advanceTimersByTimeAsync(2500);
    expect(await p).toEqual({ status: 'confirmed', card_id: 9 });
    expect(seen).toEqual(['waiting', 'waiting', 'confirmed']);
    vi.useRealTimers();
  });
  it('waitClaim: 네트워크가 잠깐 끊겨도 계속한다', async () => {
    vi.useFakeTimers();
    replies.push('network', ok({ status: 'rejected' }));
    const p = make().waitClaim({ claim_id: 1, secret: 'S' }, { every: 1000 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(await p).toEqual({ status: 'rejected' });
    vi.useRealTimers();
  });
  it('waitClaim: 서버가 거부하면(예: 401) 반복하지 않고 오류', async () => {
    replies.push(err(401, 'UNAUTHORIZED'));
    await expect(make().waitClaim({ claim_id: 1, secret: 'S' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(calls).toHaveLength(1);
  });
  it('waitClaim: stop()으로 중단', async () => {
    vi.useFakeTimers();
    replies.push(ok({ status: 'waiting' }));
    const p = make().waitClaim({ claim_id: 1, secret: 'S' }, { every: 1000 });
    await vi.advanceTimersByTimeAsync(10);
    p.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ status: 'stopped' });
    expect(calls).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe('저장소', () => {
  it('깨진 저장 값은 세션 없음으로 취급', async () => {
    mem['casino.me'] = '{broken';
    expect(make().meSession()).toBeNull();
    await expect(make().me.leave()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('logout은 해당 세션만 지운다', () => {
    putSession('staff'); putSession('me');
    const c = make();
    c.logout('me');
    expect(c.meSession()).toBeNull();
    expect(c.staffSession()).not.toBeNull();
  });
});
