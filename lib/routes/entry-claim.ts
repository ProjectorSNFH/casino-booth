import { enforceLimit } from '../db';
import { openClaim, parseSessionName } from '../entry';
import { must } from '../guard';
import { handle } from '../http';
import { parseCardId } from '../validate';

/** 참여자: 식별번호 + 세션명으로 발급 요청 (로그인 전) */
export default handle(['POST'], async ({ body, ip }) => {
  await enforceLimit(`claim-ip:${ip}`, 200, 300);
  const cardId = must(parseCardId(body.card_id));
  await enforceLimit(`claim-card:${cardId}`, 10, 300);
  const session = must(parseSessionName(body.session_name));
  return await openClaim('claim_number', cardId, session);
});
