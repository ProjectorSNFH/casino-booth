import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signAccess } from '../lib/auth';
import { ApiError } from '../lib/errors';
import { encrypt, hmacSid, sha256Hex } from '../lib/crypto';
import { verifyAccess, verifyRefresh } from '../lib/auth';

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


const SECRET = 'abcdefghijklmnopqrstuvwx';
const staffToken2 = staffToken;

describe('entry/claim', () => {
  it('식별번호와 세션명으로 요청을 만들고 비밀은 해시만 DB로 간다', async () => {
    m.rpc.mockResolvedValue(77);
    const res = await call('/api/entry/claim', { body: { card_id: '047', session_name: 'abcde' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.claim_id).toBe(77);
    expect(res.body.secret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const [fn, args] = m.rpc.mock.calls[0];
    expect(fn).toBe('claim_number');
    expect(args.p_card_id).toBe(47);
    expect(args.p_session_name).toBe('abcde');
    expect(args.p_secret_hash).toBe(sha256Hex(res.body.secret));
    expect(JSON.stringify(args)).not.toContain(res.body.secret);
    const c = await verifyAccess(res.body.claimant.token);
    expect(c).toEqual({ kind: 'claimant', claim_id: 77 });
  });
  it('rpc가 문자열 id를 줘도 숫자로 바꾼다', async () => {
    m.rpc.mockResolvedValue('78');
    const res = await call('/api/entry/claim', { body: { card_id: 1, session_name: 'abcde' } });
    expect(res.body.claim_id).toBe(78);
  });
  it('형식이 틀리면 400이고 DB를 부르지 않는다', async () => {
    for (const b of [
      { card_id: 0, session_name: 'abcde' }, { card_id: 'x', session_name: 'abcde' },
      { card_id: 1, session_name: 'ABCDE' }, { card_id: 1, session_name: 'abcd' },
      { card_id: 1, session_name: 'abcdef' }, { card_id: 1, session_name: '한글다섯자' }, { card_id: 1 },
    ]) {
      const res = await call('/api/entry/claim', { body: b });
      expect(res.statusCode).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('DB 오류 코드를 그대로 전달 (IN_USE 409, NOT_ISSUED 404)', async () => {
    m.rpc.mockRejectedValueOnce({ message: 'IN_USE' });
    expect((await call('/api/entry/claim', { body: { card_id: 1, session_name: 'abcde' } })).statusCode).toBe(409);
    m.rpc.mockRejectedValueOnce({ message: 'NOT_ISSUED' });
    expect((await call('/api/entry/claim', { body: { card_id: 1, session_name: 'abcde' } })).statusCode).toBe(404);
  });
  it('횟수 제한에 걸리면 DB를 부르지 않는다', async () => {
    m.enforceLimit.mockRejectedValueOnce(new ApiError('RATE_LIMITED'));
    const res = await call('/api/entry/claim', { body: { card_id: 1, session_name: 'abcde' } });
    expect(res.statusCode).toBe(429);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('GET은 405', async () => {
    expect((await call('/api/entry/claim', { method: 'GET' })).statusCode).toBe(405);
  });
});

describe('entry/status', () => {
  const future = () => new Date(Date.now() + 5 * 60_000).toISOString();
  const claim = (o: Record<string, unknown> = {}) => ({
    id: 5, card_id: 47, secret_hash: sha256Hex(SECRET), closed_at: null, result: null, expires_at: future(), ...o,
  });
  const setup = (c: unknown, card: unknown = { status: 'active', token_version: 3 }) => {
    m.tables = { claims: { data: c, error: null }, cards: { data: card, error: null } };
  };
  const ask = (b: object = { claim_id: 5, secret: SECRET }) => call('/api/entry/status', { body: b });

  it('대기 중이면 waiting', async () => {
    setup(claim());
    const res = await ask();
    expect(res.body).toEqual({ ok: true, status: 'waiting' });
  });
  it('만료된 대기는 expired', async () => {
    setup(claim({ expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect((await ask()).body.status).toBe('expired');
  });
  it('확정되면 토큰을 준다 (token_version 포함)', async () => {
    setup(claim({ closed_at: new Date().toISOString(), result: 'confirmed' }));
    const res = await ask();
    expect(res.body.status).toBe('confirmed');
    expect(res.body.card_id).toBe(47);
    expect(await verifyAccess(res.body.access.token)).toEqual({ kind: 'participant', card_id: 47, tv: 3 });
    expect(await verifyRefresh(res.body.refresh.token)).toEqual({ kind: 'participant', card_id: 47, tv: 3 });
  });
  it('확정 후 30분이 지나면 토큰을 주지 않는다', async () => {
    setup(claim({ closed_at: new Date(Date.now() - 31 * 60_000).toISOString(), result: 'confirmed' }));
    const res = await ask();
    expect(res.body.status).toBe('expired');
    expect(res.body.access).toBeUndefined();
  });
  it('카드가 활성이 아니면 ended, 토큰 없음', async () => {
    setup(claim({ closed_at: new Date().toISOString(), result: 'confirmed' }), { status: 'done', token_version: 3 });
    const res = await ask();
    expect(res.body.status).toBe('ended');
    expect(res.body.access).toBeUndefined();
  });
  it('거절, 취소, 만료 결과를 그대로 알려 준다', async () => {
    for (const r of ['rejected', 'cancelled', 'expired']) {
      setup(claim({ closed_at: new Date().toISOString(), result: r }));
      expect((await ask()).body.status).toBe(r);
    }
  });
  it('비밀이 틀리면 401, 요청이 없어도 같은 401', async () => {
    setup(claim());
    expect((await ask({ claim_id: 5, secret: 'z'.repeat(24) })).statusCode).toBe(401);
    setup(null);
    expect((await ask()).statusCode).toBe(401);
  });
  it('형식이 틀리면 400', async () => {
    setup(claim());
    for (const b of [{}, { claim_id: 5 }, { claim_id: 'x', secret: SECRET }, { claim_id: 5, secret: 'short' }, { claim_id: 0, secret: SECRET }]) {
      expect((await ask(b)).statusCode).toBe(400);
    }
  });
  it('응답에 비밀 해시가 없다', async () => {
    setup(claim());
    expect(JSON.stringify((await ask()).body)).not.toContain(sha256Hex(SECRET));
  });
});

describe('entry/reconnect', () => {
  const good = { sid: '20231', name: '홍길동', session_name: 'fghij' };
  const setup = (name = '홍길동') => {
    m.tables = { cards: { data: { id: 9, name_enc: encrypt(name) }, error: null } };
  };
  it('학번과 이름이 맞으면 재연결 요청을 만든다', async () => {
    setup();
    m.rpc.mockResolvedValue(31);
    const res = await call('/api/entry/reconnect', { body: good });
    expect(res.statusCode).toBe(200);
    expect(res.body.claim_id).toBe(31);
    const [fn, args] = m.rpc.mock.calls[0];
    expect(fn).toBe('request_reconnect');
    expect(args.p_card_id).toBe(9);
    expect(args.p_secret_hash).toBe(sha256Hex(res.body.secret));
    expect(JSON.stringify(res.body)).not.toContain('홍길동');
  });
  it('분해된 한글 이름도 맞는 것으로 본다', async () => {
    setup();
    m.rpc.mockResolvedValue(1);
    const res = await call('/api/entry/reconnect', { body: { ...good, name: '홍길동'.normalize('NFD') } });
    expect(res.statusCode).toBe(200);
  });
  it('이름이 틀리면 INFO_MISMATCH 404, DB 함수는 안 부른다', async () => {
    setup('김철수');
    const res = await call('/api/entry/reconnect', { body: good });
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('INFO_MISMATCH');
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('없는 학번도 같은 INFO_MISMATCH', async () => {
    m.tables = { cards: { data: null, error: null } };
    const res = await call('/api/entry/reconnect', { body: good });
    expect(res.body.code).toBe('INFO_MISMATCH');
  });
  it('학번 지문으로 조회하고 원문 학번은 쓰지 않는다 + 학번별 시도 제한', async () => {
    setup();
    m.rpc.mockResolvedValue(1);
    await call('/api/entry/reconnect', { body: good });
    expect(m.enforceLimit.mock.calls.some((c: any[]) => c[0] === `reconnect-sid:${hmacSid('20231')}`)).toBe(true);
    expect(JSON.stringify(m.enforceLimit.mock.calls)).not.toContain('20231');
  });
  it('형식이 틀리면 400', async () => {
    setup();
    for (const b of [{ ...good, sid: '1234' }, { ...good, name: 'Kim' }, { ...good, session_name: 'AB' }]) {
      expect((await call('/api/entry/reconnect', { body: b })).statusCode).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('NOT_ACTIVE 409 전달', async () => {
    setup();
    m.rpc.mockRejectedValue({ message: 'NOT_ACTIVE' });
    expect((await call('/api/entry/reconnect', { body: good })).statusCode).toBe(409);
  });
});

describe('issue/reconnect-confirm, reject', () => {
  it('suc1만 가능하고 claim_id를 숫자로 넘긴다', async () => {
    m.rpc.mockResolvedValue(2);
    const ok = await call('/api/issue/reconnect-confirm', { body: { claim_id: '12' }, token: await staffToken2('suc1') });
    expect(ok.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('confirm_reconnect', { p_claim_id: 12 });
    const rej = await call('/api/issue/reconnect-reject', { body: { claim_id: 12 }, token: await staffToken2('suc1') });
    expect(rej.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('reject_reconnect', { p_claim_id: 12 });
  });
  it('권한 없으면 403, 토큰 없으면 401', async () => {
    for (const p of ['/api/issue/reconnect-confirm', '/api/issue/reconnect-reject']) {
      expect((await call(p, { body: { claim_id: 1 }, token: await staffToken2('hg21') })).statusCode).toBe(403);
      expect((await call(p, { body: { claim_id: 1 } })).statusCode).toBe(401);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('claim_id가 틀리면 400', async () => {
    for (const v of [0, 'abc', undefined, -1, 1.5]) {
      const r = await call('/api/issue/reconnect-confirm', { body: { claim_id: v }, token: await staffToken2('suc1') });
      expect(r.statusCode).toBe(400);
    }
  });
  it('DB 오류 CLAIM_EXPIRED 409 전달', async () => {
    m.rpc.mockRejectedValue({ message: 'CLAIM_EXPIRED' });
    const r = await call('/api/issue/reconnect-confirm', { body: { claim_id: 3 }, token: await staffToken2('suc1') });
    expect(r.statusCode).toBe(409);
  });
});
