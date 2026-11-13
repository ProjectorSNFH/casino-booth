import type { VercelRequest } from '@vercel/node';
import { bearer, verifyAccess, type StaffClaims } from './auth';
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
