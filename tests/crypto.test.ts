import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt, hmacSid, randomToken, safeEqual, sha256Hex } from '../lib/crypto';

beforeEach(() => {
  process.env.PII_ENC_KEY = randomBytes(32).toString('base64');
  process.env.SID_HMAC_KEY = randomBytes(32).toString('base64');
});

describe('encrypt / decrypt', () => {
  it('한글이 왕복한다', () => {
    expect(decrypt(encrypt('홍길동'))).toBe('홍길동');
  });
  it('같은 글자도 매번 다른 암호문', () => {
    expect(encrypt('20231')).not.toBe(encrypt('20231'));
  });
  it('암호문이 바뀌면 거부', () => {
    const [iv, enc, tag] = encrypt('홍길동').split('.');
    const flipped = (enc[0] === 'A' ? 'B' : 'A') + enc.slice(1);
    expect(() => decrypt([iv, flipped, tag].join('.'))).toThrow();
  });
  it('다른 키로는 못 읽는다', () => {
    const t = encrypt('홍길동');
    process.env.PII_ENC_KEY = randomBytes(32).toString('base64');
    expect(() => decrypt(t)).toThrow();
  });
});

describe('hmacSid', () => {
  it('같은 학번은 같은 값, 64자', () => {
    expect(hmacSid('20231')).toBe(hmacSid('20231'));
    expect(hmacSid('20231')).toHaveLength(64);
  });
  it('다른 학번은 다른 값', () => {
    expect(hmacSid('20231')).not.toBe(hmacSid('20232'));
  });
  it('키가 바뀌면 다른 값', () => {
    const a = hmacSid('20231');
    process.env.SID_HMAC_KEY = randomBytes(32).toString('base64');
    expect(hmacSid('20231')).not.toBe(a);
  });
});

describe('sha256Hex', () => {
  it('알려진 값과 같다', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('safeEqual', () => {
  it('같으면 true', () => expect(safeEqual('1234', '1234')).toBe(true));
  it('다르면 false', () => expect(safeEqual('1234', '1235')).toBe(false));
  it('길이가 달라도 false (오류 없음)', () => expect(safeEqual('1234', '12345678')).toBe(false));
});

describe('randomToken', () => {
  it('24바이트는 32글자', () => expect(randomToken()).toHaveLength(32));
  it('매번 다르다', () => expect(randomToken()).not.toBe(randomToken()));
});