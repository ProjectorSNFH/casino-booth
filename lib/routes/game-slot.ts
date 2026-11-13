import { rpc } from '../db';
import { ApiError } from '../errors';
import { ownMatch, posInt, requireStaff } from '../guard';
import { handle } from '../http';

/** 칸 ✓ / ✕ 공통: match_id와 slot을 받아 내 스테이션 매치인지 확인 후 실행 */
export function slotAction(fn: 'accept_slot' | 'reject_slot') {
  return handle(['POST'], async ({ req, body }) => {
    const staff = await requireStaff(req, 'game');
    const matchId = posInt(body.match_id);
    const slot = typeof body.slot === 'number' ? body.slot : Number(body.slot);
    if (matchId === null || !Number.isInteger(slot) || slot < 0 || slot > 9) throw new ApiError('BAD_REQUEST');
    await ownMatch(staff.station, matchId);
    await rpc(fn, { p_match_id: matchId, p_slot: slot });
    return { match_id: matchId, slot };
  });
}
