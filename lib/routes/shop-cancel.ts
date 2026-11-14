import { rpc } from '../db';
import { requireParticipant } from '../guard';
import { handle } from '../http';

/** 참여자: 승인 전 주문 취소 */
export default handle(['POST'], async ({ req }) => {
  const me = await requireParticipant(req);
  await rpc('cancel_order', { p_card_id: me.card_id });
  return {};
});
