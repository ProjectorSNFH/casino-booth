import { createHmac } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { parseStation, type StationCode } from './validate';

export type ParticipantClaims = { kind: 'participant'; card_id: number; tv: number };
export type ClaimantClaims = { kind: 'claimant'; claim_id: number };
export type StaffClaims = { kind: 'staff'; station: StationCode };
export type Claims = ParticipantClaims | ClaimantClaims | StaffClaims;

const ACCESS_TTL = 10 * 60;
const CLAIMANT_TTL = 12 * 60;
const REFRESH_TTL = 14 * 60 * 60;

function secret(): string {
  const s = process.env.SUPABASE_JWT_SECRET;
  if (!s) throw new Error('SUPABASE_JWT_SECRET missing');
  return s;
}
const accessKey = () => new TextEncoder().encode(secret());
// refresh는 별도 키: Supabase가 인정하는 키로는 서명하지 않음
const refreshKey = () => createHmac('sha256', secret()).update('casino-refresh-v1').digest();

export async function signAccess(c: Claims): Promise<{ token: string; expiresAt: number }> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (c.kind === 'claimant' ? CLAIMANT_TTL : ACCESS_TTL);
  const token = await new SignJWT({ ...c, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience('authenticated')
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(accessKey());
  return { token, expiresAt: exp };
}

export async function signRefresh(
  c: ParticipantClaims | StaffClaims,
): Promise<{ token: string; expiresAt: number }> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + REFRESH_TTL;
  const token = await new SignJWT({ ...c })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('casino')
    .setAudience('casino-refresh')
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(refreshKey());
  return { token, expiresAt: exp };
}

function readClaims(p: Record<string, unknown>): Claims | null {
  if (p.kind === 'participant' && Number.isInteger(p.card_id) && Number.isInteger(p.tv)) {
    return { kind: 'participant', card_id: p.card_id as number, tv: p.tv as number };
  }
  if (p.kind === 'claimant' && Number.isInteger(p.claim_id)) {
    return { kind: 'claimant', claim_id: p.claim_id as number };
  }
  if (p.kind === 'staff') {
    const s = parseStation(p.station);
    return s.ok ? { kind: 'staff', station: s.value } : null;
  }
  return null;
}

export async function verifyAccess(token: string): Promise<Claims | null> {
  try {
    const { payload } = await jwtVerify(token, accessKey(), {
      algorithms: ['HS256'],
      audience: 'authenticated',
    });
    return readClaims(payload);
  } catch {
    return null;
  }
}

export async function verifyRefresh(token: string): Promise<ParticipantClaims | StaffClaims | null> {
  try {
    const { payload } = await jwtVerify(token, refreshKey(), {
      algorithms: ['HS256'],
      audience: 'casino-refresh',
      issuer: 'casino',
    });
    const c = readClaims(payload);
    return c && c.kind !== 'claimant' ? c : null;
  } catch {
    return null;
  }
}

/** "Bearer xxx" 헤더에서 토큰만 꺼냄 */
export function bearer(header: string | undefined): string | null {
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header ?? '');
  return m ? m[1] : null;
}