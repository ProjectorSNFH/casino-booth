import { rpc } from '../db';
import { requireParticipant } from '../guard';
import { handle } from '../http';

/** 참여자: 준비 완료 전에 매치 칸에서 나가기 */
export default handle(['POST'], async ({ req }) => {
  const me = await requireParticipant(req);
  await rpc('leave_slot', { p_card_id: me.card_id });
  return {};
});
