import { rpc } from '../db';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { parseCardId } from '../validate';

/** suc1: 카드 퇴장 / 이용 제한 */
export function cardAction(kind: 'exit' | 'ban') {
  return handle(['POST'], async ({ req, body }) => {
    await requireStaff(req, 'issue');
    const cardId = must(parseCardId(body.card_id));
    if (kind === 'exit') await rpc('exit_card', { p_card_id: cardId, p_reason: 'staff' });
    else await rpc('ban_card', { p_card_id: cardId });
    return { card_id: cardId };
  });
}
