import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../lib/crypto';
import { formatUid, isUid, makeSessionName, makeUid, newClaimSecret } from '../lib/ids';

describe('makeUid', () => {
  it('16글자, 허용 글자만', () => {
    expect(makeUid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
  });
  it('I L O U 안 나옴', () => {
    const all = Array.from({ length: 5000 }, makeUid).join('');
    expect(all).not.toMatch(/[ILOU]/);
  });
  it('1000개 모두 다름', () => {
    expect(new Set(Array.from({ length: 1000 }, makeUid)).size).toBe(1000);
  });
});

describe('isUid', () => {
  it('맞는 값 통과', () => {
    expect(isUid('0123456789ABCDEF')).toBe(true);
  });
  it('틀린 값 거부', () => {
    for (const s of ['0123456789ABCDE', '0123456789ABCDEFG', '0123456789ABCDEI', 'abcdefghjkmnpqrs', 123, null])
      expect(isUid(s)).toBe(false);
  });
});

describe('formatUid', () => {
  it('4글자씩 4줄', () => {
    expect(formatUid('0123456789ABCDEF')).toEqual(['0123', '4567', '89AB', 'CDEF']);
  });
});

describe('makeSessionName', () => {
  it('소문자 5글자', () => {
    expect(makeSessionName()).toMatch(/^[a-z]{5}$/);
  });
  it('200번 만들어도 규칙 지킴', () => {
    for (let i = 0; i < 200; i++) expect(makeSessionName()).toMatch(/^[a-z]{5}$/);
  });
});

describe('newClaimSecret', () => {
  it('해시가 원문의 sha256과 같음', () => {
    const { secret, hash } = newClaimSecret();
    expect(hash).toBe(sha256Hex(secret));
    expect(hash).toHaveLength(64);
  });
  it('매번 다름', () => {
    expect(newClaimSecret().secret).not.toBe(newClaimSecret().secret);
  });
});