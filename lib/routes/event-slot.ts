import { rpc } from '../db';
import { ApiError } from '../errors';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { parseCardId } from '../validate';

/** slt1: 슬롯 머신 결과 기록 (카드당 1번, 같은 값 재전송은 already) */
export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'event');
  const cardId = must(parseCardId(body.card_id));
  const reward = typeof body.reward === 'number' ? body.reward : typeof body.reward === 'string' && /^[0-9]{1,2}$/.test(body.reward) ? Number(body.reward) : NaN;
  if (!Number.isInteger(reward) || reward < 0 || reward > 99) throw new ApiError('BAD_REWARD');
  const r = await rpc<{ already?: boolean; reward: number; balance: number }>('slot_event', {
    p_card_id: cardId,
    p_reward: reward,
  });
  if (!r || typeof r !== 'object') throw new ApiError('INTERNAL');
  return { card_id: cardId, reward: r.reward, balance: r.balance, already: r.already === true };
});
