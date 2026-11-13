import { rpc } from '../db';
import { ApiError } from '../errors';
import { requireStaff } from '../guard';
import { handle } from '../http';

export function parseClaimId(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[0-9]{1,15}$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1) throw new ApiError('BAD_REQUEST');
  return n;
}

/** suc1: 학생증과 세션명을 대조한 뒤 재연결 확정 (이전 기기 로그아웃) */
export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'issue');
  const id = parseClaimId(body.claim_id);
  await rpc('confirm_reconnect', { p_claim_id: id });
  return { claim_id: id };
});
