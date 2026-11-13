import { sha256Hex, safeEqual } from '../crypto';
import { signAccess, signRefresh } from '../auth';
import { db, enforceLimit } from '../db';
import { ApiError } from '../errors';
import { handle } from '../http';

const GRACE_MS = 30 * 60_000; // 확정 후 30분 안에는 토큰을 다시 받을 수 있음 (네트워크 끊김 대비)

/** 새 기기: 비밀로 요청 상태를 확인하고, 확정되면 첫 토큰을 받음 */
export default handle(['POST'], async ({ body, ip }) => {
  const claimId = typeof body.claim_id === 'number' ? body.claim_id : Number(body.claim_id);
  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (!Number.isInteger(claimId) || claimId < 1 || !/^[A-Za-z0-9_-]{16,64}$/.test(secret)) {
    throw new ApiError('BAD_REQUEST');
  }
  await enforceLimit(`status-ip:${ip}`, 600, 300);
  await enforceLimit(`status-claim:${claimId}`, 300, 300);

  const { data: c, error } = await db()
    .from('claims')
    .select('id, card_id, secret_hash, closed_at, result, expires_at')
    .eq('id', claimId)
    .maybeSingle();
  if (error) throw error;
  if (!c || !c.secret_hash || !safeEqual(sha256Hex(secret), c.secret_hash)) {
    throw new ApiError('UNAUTHORIZED');
  }

  if (!c.closed_at) {
    const expired = new Date(c.expires_at).getTime() < Date.now();
    return { status: expired ? 'expired' : 'waiting' };
  }
  if (c.result !== 'confirmed') {
    return { status: c.result === 'rejected' ? 'rejected' : c.result === 'cancelled' ? 'cancelled' : 'expired' };
  }
  if (Date.now() - new Date(c.closed_at).getTime() > GRACE_MS) return { status: 'expired' };

  const { data: card, error: e2 } = await db()
    .from('cards')
    .select('status, token_version')
    .eq('id', c.card_id)
    .maybeSingle();
  if (e2) throw e2;
  if (!card || card.status !== 'active') return { status: 'ended' };

  const claims = { kind: 'participant' as const, card_id: c.card_id as number, tv: card.token_version as number };
  const [access, refresh] = await Promise.all([signAccess(claims), signRefresh(claims)]);
  return { status: 'confirmed', card_id: c.card_id, access, refresh };
});
