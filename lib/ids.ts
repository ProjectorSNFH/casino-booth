import { randomBytes, randomInt } from 'node:crypto';
import { randomToken, sha256Hex } from './crypto';

// 32글자. 256이 32로 나누어 떨어져서 한쪽으로 쏠리지 않음
const UID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function makeUid(): string {
  return Array.from(randomBytes(16), (b) => UID_ALPHABET[b % 32]).join('');
}

export const isUid = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9A-HJKMNP-TV-Z]{16}$/.test(s);

/** 화면용: 4글자씩 4줄 */
export const formatUid = (uid: string): string[] => uid.match(/.{4}/g) ?? [];

/** 소문자 5글자. 겹치면 DB가 SESSION_NAME_TAKEN을 내고 서버가 다시 만듦 */
export function makeSessionName(): string {
  return Array.from({ length: 5 }, () => String.fromCharCode(97 + randomInt(26))).join('');
}

/** 새 기기에 줄 비밀(원문)과 DB에 저장할 해시 */
export function newClaimSecret(): { secret: string; hash: string } {
  const secret = randomToken(24);
  return { secret, hash: sha256Hex(secret) };
}