import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signAccess } from '../lib/auth';
import { decrypt } from '../lib/crypto';
import { ApiError } from '../lib/errors';
import { isUid } from '../lib/ids';

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

describe('issue/create', () => {
  const good = { sid: '20231', name: '홍길동', part: 1 };
  it('토큰이 없으면 401', async () => {
    const res = await call('/api/issue/create', { body: good });
    expect(res.statusCode).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('게임 스태프 토큰은 403', async () => {
    const res = await call('/api/issue/create', { body: good, token: await staffToken('hg21') });
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('엉터리 토큰은 401', async () => {
    expect((await call('/api/issue/create', { body: good, token: 'abc.def.ghi' })).statusCode).toBe(401);
  });
  it('형식이 틀리면 400이고 DB를 부르지 않는다', async () => {
    const token = await staffToken('suc1');
    for (const [body, code] of [
      [{ ...good, sid: '2023' }, 'BAD_SID'],
      [{ ...good, name: '홍' }, 'BAD_NAME'],
      [{ ...good, name: 'Kim' }, 'BAD_NAME'],
      [{ ...good, part: 3 }, 'BAD_PART'],
    ] as const) {
      const res = await call('/api/issue/create', { body, token });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe(code);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('정상: 암호화해서 DB 함수에 넘기고 원문은 넘기지 않는다', async () => {
    m.rpc.mockResolvedValue(213);
    const res = await call('/api/issue/create', { body: good, token: await staffToken('suc1') });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, card_id: 213 });
    const [name, args] = m.rpc.mock.calls[0];
    expect(name).toBe('issue_card');
    expect(args.p_part).toBe(1);
    expect(args.p_sid_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(decrypt(args.p_name_enc)).toBe('홍길동');
    expect(decrypt(args.p_sid_enc)).toBe('20231');
    expect(args.p_mask).toBe('홍*동');
    expect(isUid(args.p_uid)).toBe(true);
    expect(Object.values(args)).not.toContain('20231');
    expect(Object.values(args)).not.toContain('홍길동');
  });
  it('같은 학번은 항상 같은 지문', async () => {
    m.rpc.mockResolvedValue(1);
    const token = await staffToken('suc1');
    await call('/api/issue/create', { body: good, token });
    await call('/api/issue/create', { body: { ...good, name: '김철수' }, token });
    expect(m.rpc.mock.calls[0][1].p_sid_hmac).toBe(m.rpc.mock.calls[1][1].p_sid_hmac);
  });
  it('분해된 한글 이름도 합쳐서 저장', async () => {
    m.rpc.mockResolvedValue(1);
    await call('/api/issue/create', { body: { ...good, name: '홍길동'.normalize('NFD') }, token: await staffToken('suc1') });
    expect(decrypt(m.rpc.mock.calls[0][1].p_name_enc)).toBe('홍길동');
  });
  it('DB가 낸 오류 코드를 그대로 전달 (PART_ENDED 409)', async () => {
    m.rpc.mockRejectedValue(new ApiError('PART_ENDED'));
    const res = await call('/api/issue/create', { body: good, token: await staffToken('suc1') });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('PART_ENDED');
  });
});

describe('issue/confirm, issue/cancel', () => {
  it('confirm: 문자열 식별번호도 받는다', async () => {
    m.rpc.mockResolvedValue(47);
    const res = await call('/api/issue/confirm', { body: { card_id: '047' }, token: await staffToken('suc1') });
    expect(res.statusCode).toBe(200);
    expect(res.body.card_id).toBe(47);
    expect(m.rpc).toHaveBeenCalledWith('confirm_card', { p_card_id: 47 });
  });
  it('confirm: 잘못된 식별번호 400', async () => {
    const res = await call('/api/issue/confirm', { body: { card_id: 0 }, token: await staffToken('suc1') });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BAD_CARD_ID');
  });
  it('confirm: DB 오류 NO_CLAIM 404 전달', async () => {
    m.rpc.mockRejectedValue(new ApiError('NO_CLAIM'));
    const res = await call('/api/issue/confirm', { body: { card_id: 3 }, token: await staffToken('suc1') });
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('NO_CLAIM');
  });
  it('confirm, cancel: 권한 없으면 403', async () => {
    const token = await staffToken('shp1');
    expect((await call('/api/issue/confirm', { body: { card_id: 3 }, token })).statusCode).toBe(403);
    expect((await call('/api/issue/cancel', { body: { card_id: 3 }, token })).statusCode).toBe(403);
  });
  it('cancel: 정상', async () => {
    m.rpc.mockResolvedValue(null);
    const res = await call('/api/issue/cancel', { body: { card_id: 3 }, token: await staffToken('suc1') });
    expect(res.statusCode).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('cancel_issue', { p_card_id: 3 });
  });
});

describe('issue/state', () => {
  const soon = new Date(Date.now() + 5 * 60_000).toISOString();
  const past = new Date(Date.now() - 5 * 60_000).toISOString();
  const base = () => {
    m.tables = {
      stations: { data: { current_card_id: 3 }, error: null },
      config: { data: [
        { key: 'parts', value: { '1': 'active', '2': 'ended' } },
        { key: 'limits', value: { active_cap: 15 } },
      ], error: null },
      cards: { data: [
        { id: 1, part: 1, status: 'active', mask_name: '가*나' },
        { id: 2, part: 1, status: 'done', mask_name: '다*라' },
        { id: 3, part: 1, status: 'pending', mask_name: '마*바' },
        { id: 501, part: 2, status: 'active', mask_name: '사*아' },
      ], error: null },
      claims: { data: [
        { id: 10, card_id: 3, kind: 'issue', session_name: 'abcde', expires_at: soon },
        { id: 11, card_id: 1, kind: 'reconnect', session_name: 'fghij', expires_at: soon },
        { id: 12, card_id: 501, kind: 'reconnect', session_name: 'klmno', expires_at: past },
      ], error: null },
    };
  };
  it('토큰 없으면 401, POST는 405', async () => {
    expect((await call('/api/issue/state', { method: 'GET' })).statusCode).toBe(401);
    expect((await call('/api/issue/state', { method: 'POST', token: await staffToken('suc1') })).statusCode).toBe(405);
  });
  it('현재 상태를 한 번에 돌려준다', async () => {
    base();
    const res = await call('/api/issue/state', { method: 'GET', token: await staffToken('suc1') });
    expect(res.statusCode).toBe(200);
    expect(res.body.pending).toEqual({
      card_id: 3, part: 1, mask_name: '마*바',
      claim: { id: 10, session_name: 'abcde', expired: false },
    });
    expect(res.body.counts).toEqual({ issued: { 1: 3, 2: 1 }, active: 2 });
    expect(res.body.parts).toEqual({ '1': 'active', '2': 'ended' });
    expect(res.body.limits).toEqual({ active_cap: 15 });
  });
  it('만료되지 않은 재연결 요청만 보여준다', async () => {
    base();
    const res = await call('/api/issue/state', { method: 'GET', token: await staffToken('suc1') });
    expect(res.body.reconnects).toEqual([{ claim_id: 11, card_id: 1, session_name: 'fghij' }]);
  });
  it('비밀 해시와 이름은 내보내지 않는다', async () => {
    base();
    (m.tables.claims as any).data[0].secret_hash = 'SHOULD-NOT-LEAK';
    const res = await call('/api/issue/state', { method: 'GET', token: await staffToken('suc1') });
    const s = JSON.stringify(res.body);
    expect(s).not.toContain('SHOULD-NOT-LEAK');
    expect(s).not.toContain('secret');
    expect(s).not.toContain('name_enc');
  });
  it('발급 대기가 없으면 pending은 null', async () => {
    base();
    (m.tables.stations as any).data.current_card_id = null;
    const res = await call('/api/issue/state', { method: 'GET', token: await staffToken('suc1') });
    expect(res.body.pending).toBeNull();
  });
  it('세션명 요청이 만료됐으면 expired true', async () => {
    base();
    (m.tables.claims as any).data[0].expires_at = past;
    const res = await call('/api/issue/state', { method: 'GET', token: await staffToken('suc1') });
    expect(res.body.pending.claim.expired).toBe(true);
  });
  it('참여자가 아직 번호를 안 넣었으면 claim은 null', async () => {
    base();
    (m.tables.claims as any).data = [];
    const res = await call('/api/issue/state', { method: 'GET', token: await staffToken('suc1') });
    expect(res.body.pending.claim).toBeNull();
  });
  it('DB 오류는 500, 원문은 숨김', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    base();
    (m.tables.cards as any) = { data: null, error: { message: 'connection to 10.0.0.5 refused' } };
    const res = await call('/api/issue/state', { method: 'GET', token: await staffToken('suc1') });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
    spy.mockRestore();
  });
});
