import { rpc } from '../db';
import { ApiError } from '../errors';
import { posInt, requireParticipant } from '../guard';
import { handle } from '../http';

/** 참여자: 베팅 금액 확정 (코인은 정산 때까지 차감되지 않음) */
export default handle(['POST'], async ({ req, body }) => {
  const me = await requireParticipant(req);
  const bet = posInt(body.bet);
  if (bet === null) throw new ApiError('BAD_BET');
  await rpc('set_bet', { p_card_id: me.card_id, p_bet: bet });
  return { bet };
});
