import { decrypt, safeEqual } from '../crypto';
import { clearLimit, db, enforceLimit } from '../db';
import { ApiError } from '../errors';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { parseCardId } from '../validate';

/** 개인정보를 볼 수 있는 순위 (이 순위 안의 카드만 조회 가능). 상품 수에 맞게 조정 */
export const WINNER_RANKS = 10;

/** tbs1: 우승자 실명·학번 열람. PIN 재입력 필수, 모든 열람은 audit_log에 기록 */
export default handle(['POST'], async ({ req, body, ip }) => {
  const staff = await requireStaff(req, 'hof');
  const cardId = must(parseCardId(body.card_id));

  const expected = process.env.STAFF_PIN;
  if (!expected) throw new Error('STAFF_PIN missing');
  if (typeof body.pin !== 'string' || body.pin === '') throw new ApiError('PIN_REQUIRED');
  await enforceLimit(`pii-pin:${ip}`, 5, 300);
  if (!safeEqual(body.pin, expected)) throw new ApiError('WRONG_PIN');
  await clearLimit(`pii-pin:${ip}`);
  await enforceLimit('pii-all', 60, 600); // 전체 열람 횟수 상한

  const d = db();
  const r = await d.from('hof_rank').select('rank').eq('card_id', cardId).maybeSingle();
  if (r.error) throw r.error;
  if (!r.data || r.data.rank > WINNER_RANKS) throw new ApiError('FORBIDDEN');

  const c = await d.from('cards').select('name_enc, sid_enc').eq('id', cardId).maybeSingle();
  if (c.error) throw c.error;
  if (!c.data) throw new ApiError('NOT_FOUND');

  // 기록이 남지 않으면 보여주지 않는다 (먼저 기록)
  const log = await d.from('audit_log').insert({
    table_name: 'pii_view',
    op: 'VIEW',
    new_row: { card_id: cardId, rank: r.data.rank, station: staff.station },
  });
  if (log.error) throw log.error;

  let name: string;
  let sid: string;
  try {
    name = decrypt(c.data.name_enc);
    sid = decrypt(c.data.sid_enc);
  } catch {
    throw new ApiError('INTERNAL');
  }
  return { card_id: cardId, rank: Number(r.data.rank), name, sid };
});
