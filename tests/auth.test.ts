import { beforeEach, describe, expect, it } from 'vitest';
import { SignJWT, decodeJwt } from 'jose';
import { bearer, signAccess, signRefresh, verifyAccess, verifyRefresh } from '../lib/auth';

const SECRET = 'test-legacy-jwt-secret-for-vitest-0123456789';
const enc = (s: string) => new TextEncoder().encode(s);
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
});

describe('access token', () => {
  it('참여자 왕복', async () => {
    const { token } = await signAccess({ kind: 'participant', card_id: 47, tv: 2 });
    expect(await verifyAccess(token)).toEqual({ kind: 'participant', card_id: 47, tv: 2 });
  });
  it('요청자 왕복', async () => {
    const { token } = await signAccess({ kind: 'claimant', claim_id: 9 });
    expect(await verifyAccess(token)).toEqual({ kind: 'claimant', claim_id: 9 });
  });
  it('스태프 왕복', async () => {
    const { token } = await signAccess({ kind: 'staff', station: 'hg21' });
    expect(await verifyAccess(token)).toEqual({ kind: 'staff', station: 'hg21' });
  });
  it('role, aud 와 10분 만료', async () => {
    const { token, expiresAt } = await signAccess({ kind: 'participant', card_id: 1, tv: 1 });
    const p = decodeJwt(token);
    expect(p.role).toBe('authenticated');
    expect(p.aud).toBe('authenticated');
    expect(p.exp).toBe(expiresAt);
    expect(p.exp! - p.iat!).toBe(600);
  });
  it('요청자는 12분', async () => {
    const { token } = await signAccess({ kind: 'claimant', claim_id: 1 });
    const p = decodeJwt(token);
    expect(p.exp! - p.iat!).toBe(720);
  });
  it('조작된 토큰 거부', async () => {
    const { token } = await signAccess({ kind: 'participant', card_id: 1, tv: 1 });
    const bad = token.slice(0, -3) + (token.endsWith('AAA') ? 'BBB' : 'AAA');
    expect(await verifyAccess(bad)).toBeNull();
  });
  it('다른 비밀로 서명한 토큰 거부', async () => {
    const t = await new SignJWT({ kind: 'participant', card_id: 1, tv: 1, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('authenticated')
      .setExpirationTime(now() + 600)
      .sign(enc('other-secret'));
    expect(await verifyAccess(t)).toBeNull();
  });
  it('만료된 토큰 거부', async () => {
    const t = await new SignJWT({ kind: 'participant', card_id: 1, tv: 1, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('authenticated')
      .setIssuedAt(now() - 1000)
      .setExpirationTime(now() - 500)
      .sign(enc(SECRET));
    expect(await verifyAccess(t)).toBeNull();
  });
  it('HS256 아닌 알고리즘 거부', async () => {
    const t = await new SignJWT({ kind: 'participant', card_id: 1, tv: 1, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS512' })
      .setAudience('authenticated')
      .setExpirationTime(now() + 600)
      .sign(enc(SECRET));
    expect(await verifyAccess(t)).toBeNull();
  });
  it('값 모양이 틀리면 거부', async () => {
    const t = await new SignJWT({ kind: 'participant', card_id: '1', tv: 1, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('authenticated')
      .setExpirationTime(now() + 600)
      .sign(enc(SECRET));
    expect(await verifyAccess(t)).toBeNull();
  });
  it('모르는 스테이션 거부', async () => {
    const t = await new SignJWT({ kind: 'staff', station: 'zzzz', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('authenticated')
      .setExpirationTime(now() + 600)
      .sign(enc(SECRET));
    expect(await verifyAccess(t)).toBeNull();
  });
});

describe('refresh token', () => {
  it('왕복', async () => {
    const { token } = await signRefresh({ kind: 'participant', card_id: 5, tv: 3 });
    expect(await verifyRefresh(token)).toEqual({ kind: 'participant', card_id: 5, tv: 3 });
  });
  it('14시간', async () => {
    const { token } = await signRefresh({ kind: 'staff', station: 'suc1' });
    const p = decodeJwt(token);
    expect(p.exp! - p.iat!).toBe(14 * 3600);
  });
  it('refresh를 access로 쓰면 거부', async () => {
    const { token } = await signRefresh({ kind: 'participant', card_id: 5, tv: 3 });
    expect(await verifyAccess(token)).toBeNull();
  });
  it('access를 refresh로 쓰면 거부', async () => {
    const { token } = await signAccess({ kind: 'participant', card_id: 5, tv: 3 });
    expect(await verifyRefresh(token)).toBeNull();
  });
});

describe('bearer', () => {
  it('Bearer 토큰 꺼냄', () => {
    expect(bearer('Bearer abc.def-ghi_1')).toBe('abc.def-ghi_1');
  });
  it('이상한 헤더는 null', () => {
    for (const h of [undefined, '', 'Basic abc', 'Bearer', 'Bearer a b', 'bearer abc'])
      expect(bearer(h)).toBeNull();
  });
});