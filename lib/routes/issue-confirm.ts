import { rpc } from '../db';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { parseCardId } from '../validate';

export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'issue');
  const id = must(parseCardId(body.card_id));
  await rpc('confirm_card', { p_card_id: id });
  return { card_id: id };
});
