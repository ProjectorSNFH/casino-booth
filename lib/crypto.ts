import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual,
} from 'node:crypto';

function key(name: 'PII_ENC_KEY' | 'SID_HMAC_KEY'): Buffer {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} missing`);
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes`);
  return k;
}

/** AES-256-GCM. 결과: iv.암호문.태그 (base64url, 점으로 구분) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key('PII_ENC_KEY'), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, enc, c.getAuthTag()].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('bad ciphertext');
  const [iv, enc, tag] = parts.map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key('PII_ENC_KEY'), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/** 학번 지문 (중복 확인용). 같은 학번 = 같은 값 */
export function hmacSid(sid: string): string {
  return createHmac('sha256', key('SID_HMAC_KEY')).update(sid).digest('hex');
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** 길이가 달라도 터지지 않고, 시간 차이로 힌트를 주지 않는 비교 */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}