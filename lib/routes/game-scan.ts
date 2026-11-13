import { rpc } from '../db';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { parseCardId } from '../validate';

/** 게임 스태프 📷: 카드를 내 스테이션의 매치 칸에 배정 */
export default handle(['POST'], async ({ req, body }) => {
  const staff = await requireStaff(req, 'game');
  const cardId = must(parseCardId(body.card_id));
  const r = await rpc<{ match_id: number | string; slot: number }>('scan_card', {
    p_station: staff.station,
    p_card_id: cardId,
  });
  return { card_id: cardId, match_id: Number(r.match_id), slot: r.slot };
});
