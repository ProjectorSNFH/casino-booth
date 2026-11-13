import { randomToken, sha256Hex } from './crypto';
import { signAccess } from './auth';
import { rpc } from './db';
import { ApiError } from './errors';
import type { Parsed } from './validate';

/** 세션명: 영어 소문자 5자 */
export function parseSessionName(v: unknown): Parsed<string> {
  return typeof v === 'string' && /^[a-z]{5}$/.test(v)
    ? { ok: true, value: v }
    : { ok: false, code: 'BAD_REQUEST' };
}

/** claim_number / request_reconnect 호출 공통부. 비밀은 새 기기에만 준다. */
export async function openClaim(
  fn: 'claim_number' | 'request_reconnect',
  cardId: number,
  sessionName: string,
) {
  const secret = randomToken(24);
  const raw = await rpc<number | string>(fn, {
    p_card_id: cardId,
    p_session_name: sessionName,
    p_secret_hash: sha256Hex(secret),
  });
  const claimId = Number(raw);
  if (!Number.isInteger(claimId)) throw new ApiError('INTERNAL');
  const claimant = await signAccess({ kind: 'claimant', claim_id: claimId });
  return { claim_id: claimId, secret, session_name: sessionName, claimant };
}

