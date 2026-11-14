import { db, rpc } from '../db';
import { ApiError } from '../errors';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { isUid } from '../ids';
import { parseCardId } from '../validate';

/** 게임 스태프 📷: 카드를 내 스테이션의 매치 칸에 배정.
 *  QR을 읽으면 uid(16자리), 손으로 입력하면 card_id(1~999)를 보낸다. */
export default handle(['POST'], async ({ req, body }) => {
  const staff = await requireStaff(req, 'game');

  let cardId: number;
  if (body.uid !== undefined && body.uid !== null && body.uid !== '') {
    const uid = typeof body.uid === 'string' ? body.uid.trim().toUpperCase() : '';
    if (!isUid(uid)) throw new ApiError('NOT_FOUND');
    const { data, error } = await db().from('cards').select('id').eq('uid', uid).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError('NOT_FOUND');
    cardId = Number((data as { id: number | string }).id);
  } else {
    cardId = must(parseCardId(body.card_id));
  }

  const r = await rpc<{ match_id: number | string; slot: number }>('scan_card', {
    p_station: staff.station,
    p_card_id: cardId,
  });
  return { card_id: cardId, match_id: Number(r.match_id), slot: r.slot };
});
