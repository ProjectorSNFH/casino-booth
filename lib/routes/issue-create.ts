import { encrypt, hmacSid } from '../crypto';
import { rpc } from '../db';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { makeUid } from '../ids';
import { maskName, parseName, parsePart, parseSid } from '../validate';

export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'issue');
  const sid = must(parseSid(body.sid));
  const name = must(parseName(body.name));
  const part = must(parsePart(body.part));

  const cardId = await rpc<number>('issue_card', {
    p_part: part,
    p_sid_hmac: hmacSid(sid),
    p_name_enc: encrypt(name),
    p_sid_enc: encrypt(sid),
    p_mask: maskName(name),
    p_uid: makeUid(),
  });
  return { card_id: cardId };
});
