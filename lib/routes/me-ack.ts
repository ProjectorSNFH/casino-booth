import { rpc } from '../db';
import { requireParticipant } from '../guard';
import { handle } from '../http';

/** 참여자 "확인": 확인 시각만 기록 (정산을 막지 않음) */
export default handle(['POST'], async ({ req }) => {
  const me = await requireParticipant(req);
  await rpc('ack_result', { p_card_id: me.card_id });
  return {};
});
