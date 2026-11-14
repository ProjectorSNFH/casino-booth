import { db } from '../db';
import { ApiError } from '../errors';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { cardExists, parseCount, parseGame } from '../adjust';
import { parseCardId } from '../validate';

/** suc2: 게임 참여 횟수를 값으로 직접 지정 */
export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'adjust');
  const cardId = must(parseCardId(body.card_id));
  const game = parseGame(body.game);
  const n = parseCount(body.n);
  await cardExists(cardId);
  const { data, error } = await db()
    .from('glist')
    .upsert({ card_id: cardId, game, n, updated_at: new Date().toISOString() }, { onConflict: 'card_id,game' })
    .select('card_id');
  if (error) throw error;
  if (!data || data.length === 0) throw new ApiError('INTERNAL');
  return { card_id: cardId, game, n };
});
