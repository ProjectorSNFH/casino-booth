import { rpc } from '../db';
import { requireParticipant } from '../guard';
import { handle } from '../http';
import { parseItems } from '../shop';

/** 참여자 "완료": 주문 생성. 보낸 금액은 받지 않고 DB가 가격을 계산 */
export default handle(['POST'], async ({ req, body }) => {
  const me = await requireParticipant(req);
  const items = parseItems(body.items);
  const id = await rpc<number | string>('create_order', { p_card_id: me.card_id, p_items: items });
  return { order_id: Number(id) };
});
