import type { VercelRequest } from '@vercel/node';
import { bearer, verifyAccess, type StaffClaims } from './auth';
import { db } from './db';
import { ApiError, isErrorCode, type ErrorCode } from './errors';
import { STATION_ROLES, type Parsed } from './validate';

type Role = (typeof STATION_ROLES)[keyof typeof STATION_ROLES];

/** 스태프 토큰을 확인하고, 허용된 역할인지 검사 */
export async function requireStaff(
  req: Pick<VercelRequest, 'headers'>,
  ...roles: Role[]
): Promise<StaffClaims> {
  const h = req.headers.authorization;
  const token = bearer(Array.isArray(h) ? h[0] : h);
  if (!token) throw new ApiError('UNAUTHORIZED');
  const c = await verifyAccess(token);
  if (!c || c.kind !== 'staff') throw new ApiError('UNAUTHORIZED');
  if (!roles.includes(STATION_ROLES[c.station])) throw new ApiError('FORBIDDEN');
  return c;
}

/** 검사 결과에서 값을 꺼냄. 틀렸으면 그 코드로 오류를 던짐 */
export function must<T>(p: Parsed<T>): T {
  if (p.ok) return p.value;
  throw new ApiError(isErrorCode(p.code) ? (p.code as ErrorCode) : 'BAD_REQUEST');
}

/** 참여자 토큰 확인. 다른 기기가 재연결했으면(token_version 불일치) STALE_TOKEN */
export async function requireParticipant(req: Pick<VercelRequest, 'headers'>): Promise<{ card_id: number }> {
  const h = req.headers.authorization;
  const token = bearer(Array.isArray(h) ? h[0] : h);
  if (!token) throw new ApiError('UNAUTHORIZED');
  const c = await verifyAccess(token);
  if (!c || c.kind !== 'participant') throw new ApiError('UNAUTHORIZED');
  const { data, error } = await db()
    .from('cards')
    .select('token_version')
    .eq('id', c.card_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError('UNAUTHORIZED');
  if (data.token_version !== c.tv) throw new ApiError('STALE_TOKEN');
  return { card_id: c.card_id };
}

/** 이 매치가 내 스테이션의 것인지 확인 (다른 게임 스태프가 남의 매치를 건드리지 못하게) */
export async function ownMatch(station: string, matchId: number): Promise<void> {
  const { data, error } = await db().from('matches').select('station').eq('id', matchId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError('NO_MATCH');
  if (data.station !== station) throw new ApiError('FORBIDDEN');
}

/** 양의 정수 (문자열 숫자도 허용) */
export function posInt(v: unknown, max = 1_000_000_000): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[0-9]{1,10}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}
