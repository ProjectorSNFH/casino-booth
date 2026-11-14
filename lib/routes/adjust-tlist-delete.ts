import { db } from '../db';
import { ApiError } from '../errors';
import { requireStaff } from '../guard';
import { handle } from '../http';
import { assertBalanceOk, balanceOf, getTRow, parseRowId } from '../adjust';

/** suc2: 기록 삭제. 삭제한 행은 감사 기록(audit_log)에 자동 보관됨 */
export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'adjust');
  const id = parseRowId(body.id);
  const row = await getTRow(id);
  assertBalanceOk((await balanceOf(row.card_id)) - row.coin_delta);
  const { data, error } = await db().from('tlist').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new ApiError('NOT_FOUND');
  return { id, card_id: row.card_id };
});
