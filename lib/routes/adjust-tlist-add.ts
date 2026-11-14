import { db } from '../db';
import { ApiError } from '../errors';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { assertBalanceOk, balanceOf, cardExists, parseDelta, parseText } from '../adjust';
import { parseCardId } from '../validate';

/** suc2: 정정 기록 추가 (ADJUST) */
export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'adjust');
  const cardId = must(parseCardId(body.card_id));
  const delta = parseDelta(body.delta);
  const reason = parseText(body.reason);
  await cardExists(cardId);
  assertBalanceOk((await balanceOf(cardId)) + delta);
  const { data, error } = await db()
    .from('tlist')
    .insert({ card_id: cardId, content: 'ADJUST ' + reason, coin_delta: delta, kind: 'ADJUST' })
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new ApiError('INTERNAL');
  return { id: Number((data[0] as { id: number }).id) };
});
