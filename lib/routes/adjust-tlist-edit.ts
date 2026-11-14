import { db } from '../db';
import { ApiError } from '../errors';
import { requireStaff } from '../guard';
import { handle } from '../http';
import { assertBalanceOk, balanceOf, getTRow, parseDelta, parseRowId, parseText } from '../adjust';

/** suc2: 기록 수정 (변화량, 내용). 원래 값은 감사 기록(audit_log)에 자동 보관됨 */
export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'adjust');
  const id = parseRowId(body.id);
  const patch: Record<string, unknown> = {};
  if (body.coin_delta !== undefined) patch.coin_delta = parseDelta(body.coin_delta);
  if (body.content !== undefined) patch.content = parseText(body.content, 120);
  if (Object.keys(patch).length === 0) throw new ApiError('BAD_REQUEST');

  const row = await getTRow(id);
  if (typeof patch.coin_delta === 'number') {
    assertBalanceOk((await balanceOf(row.card_id)) - row.coin_delta + patch.coin_delta);
  }
  const { data, error } = await db().from('tlist').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new ApiError('NOT_FOUND');
  return { id, card_id: row.card_id, ...patch };
});
