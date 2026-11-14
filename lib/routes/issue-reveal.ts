import { decrypt } from '../crypto';
import { db, enforceLimit } from '../db';
import { ApiError } from '../errors';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { parseCardId } from '../validate';

/** suc1: 카드 한 장의 이름 보기 (학번은 주지 않음). 열람은 audit_log에 먼저 기록하고, 기록 실패 시 거부 */
export default handle(['POST'], async ({ req, body }) => {
  const staff = await requireStaff(req, 'issue');
  const cardId = must(parseCardId(body.card_id));
  await enforceLimit('reveal-all', 300, 600);

  const d = db();
  const c = await d.from('cards').select('name_enc').eq('id', cardId).maybeSingle();
  if (c.error) throw c.error;
  if (!c.data) throw new ApiError('NOT_FOUND');

  const log = await d.from('audit_log').insert({
    table_name: 'pii_view', op: 'VIEW_NAME', new_row: { card_id: cardId, station: staff.station },
  });
  if (log.error) throw log.error;

  let name: string;
  try { name = decrypt(c.data.name_enc); } catch { throw new ApiError('INTERNAL'); }
  return { card_id: cardId, name };
});
