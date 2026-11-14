import { decrypt, hmacSid, safeEqual } from '../crypto';
import { db, enforceLimit } from '../db';
import { openClaim, parseSessionName } from '../entry';
import { ApiError } from '../errors';
import { must } from '../guard';
import { handle } from '../http';
import { parseName, parseSid } from '../validate';

/** 참여자: 학번 + 이름으로 내 카드를 찾아 재연결 요청 (새 기기) */
export default handle(['POST'], async ({ body, ip }) => {
  await enforceLimit(`reconnect-ip:${ip}`, 100, 300);
  const sid = must(parseSid(body.sid));
  const name = must(parseName(body.name));
  const session = must(parseSessionName(body.session_name));

  const h = hmacSid(sid);
  await enforceLimit(`reconnect-sid:${h}`, 5, 600); // 이름 대입 공격 방지

  const { data, error } = await db()
    .from('cards')
    .select('id, name_enc')
    .eq('sid_hmac', h)
    .maybeSingle();
  if (error) throw error;

  // 없는 학번과 틀린 이름은 같은 오류 (학번이 등록됐는지 알려주지 않음)
  if (!data) throw new ApiError('INFO_MISMATCH');
  let stored = '';
  try { stored = decrypt(data.name_enc); } catch { throw new ApiError('INTERNAL'); }
  if (!safeEqual(stored.normalize('NFC'), name)) throw new ApiError('INFO_MISMATCH');

  // 학번+이름이 맞은 사람에게만 번호를 알려줌 (화면에 "기존 식별번호"로 보여주기 위함)
  const claim = await openClaim('request_reconnect', data.id, session);
  return { ...claim, card_id: data.id as number };
});
