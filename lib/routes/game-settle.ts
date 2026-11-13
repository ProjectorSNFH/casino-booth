import { rpc } from '../db';
import { ApiError } from '../errors';
import { ownMatch, posInt, requireStaff } from '../guard';
import { handle } from '../http';

/** 정산 승인: 코인이 실제로 움직이는 유일한 API. 두 번 보내도 한 번만 정산됨 */
export default handle(['POST'], async ({ req, body }) => {
  const staff = await requireStaff(req, 'game');
  const matchId = posInt(body.match_id);
  if (matchId === null) throw new ApiError('BAD_REQUEST');
  await ownMatch(staff.station, matchId);
  const r = await rpc<unknown>('settle_match', { p_match_id: matchId });
  if (Array.isArray(r)) return { match_id: matchId, already: false, results: r };
  return { match_id: matchId, already: true, results: [] };
});
