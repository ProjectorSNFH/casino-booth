import { describe, expect, it } from 'vitest';
import {
  STATION_ROLES, maskName, parseBet, parseCardId, parseName,
  parseOrderItems, parsePart, parseSid, parseStation,
} from '../lib/validate';

describe('parseSid', () => {
  it('5자리 숫자 통과', () => {
    expect(parseSid('20231')).toEqual({ ok: true, value: '20231' });
  });
  it('자리수가 틀리면 거부', () => {
    expect(parseSid('2023')).toEqual({ ok: false, code: 'BAD_SID' });
    expect(parseSid('202311').ok).toBe(false);
  });
  it('글자나 공백이 섞이면 거부', () => {
    for (const s of ['2023a', '2023 ', ' 20231', '２０２３１']) expect(parseSid(s).ok).toBe(false);
  });
  it('문자열이 아니면 거부', () => {
    expect(parseSid(20231).ok).toBe(false);
  });
});

describe('parseName', () => {
  it('한글 2~5자 통과', () => {
    for (const n of ['홍길', '홍길동', '남궁민수아']) expect(parseName(n)).toEqual({ ok: true, value: n });
  });
  it('1자와 6자 거부', () => {
    expect(parseName('홍').ok).toBe(false);
    expect(parseName('가나다라마바').ok).toBe(false);
  });
  it('숫자, 영어, 공백, 특수기호 거부', () => {
    for (const n of ['홍길동1', 'Kim', '홍 길동', '홍길!', 'a홍길']) expect(parseName(n).ok).toBe(false);
  });
  it('자모만 있으면 거부', () => {
    expect(parseName('ㅎㅗㅇ').ok).toBe(false);
  });
  it('분해된 한글은 합쳐서 통과', () => {
    expect(parseName('홍길동'.normalize('NFD'))).toEqual({ ok: true, value: '홍길동' });
  });
});

describe('parsePart', () => {
  it('1, 2 통과 (문자열도 허용)', () => {
    expect(parsePart(1)).toEqual({ ok: true, value: 1 });
    expect(parsePart('2')).toEqual({ ok: true, value: 2 });
  });
  it('그 외 거부', () => {
    for (const p of [0, 3, '3', null, '']) expect(parsePart(p).ok).toBe(false);
  });
});

describe('parseCardId', () => {
  it('3자리 문자열과 숫자 통과', () => {
    expect(parseCardId('047')).toEqual({ ok: true, value: 47 });
    expect(parseCardId(47)).toEqual({ ok: true, value: 47 });
    expect(parseCardId('999')).toEqual({ ok: true, value: 999 });
  });
  it('범위 밖과 이상한 값 거부', () => {
    for (const c of [0, 1000, '0000', 'abc', 1.5, '-1', null]) expect(parseCardId(c).ok).toBe(false);
  });
});

describe('parseBet', () => {
  it('1~9999 정수 통과', () => {
    for (const b of [1, 5, 9999]) expect(parseBet(b)).toEqual({ ok: true, value: b });
  });
  it('0, 음수, 소수, 문자열, 너무 큰 값 거부', () => {
    for (const b of [0, -1, 1.5, '3', 10000, NaN]) expect(parseBet(b).ok).toBe(false);
  });
});

describe('parseStation', () => {
  it('대문자도 소문자로 바꿔 통과', () => {
    expect(parseStation('HG21')).toEqual({ ok: true, value: 'hg21' });
  });
  it('모르는 코드 거부', () => {
    expect(parseStation('zzzz').ok).toBe(false);
    expect(parseStation(1234).ok).toBe(false);
  });
  it('코드별 역할', () => {
    expect(STATION_ROLES.suc1).toBe('issue');
    expect(STATION_ROLES.hg21).toBe('game');
    expect(STATION_ROLES.slt1).toBe('event');
    expect(STATION_ROLES.shp2).toBe('shop_deliver');
  });
});

describe('parseOrderItems', () => {
  it('정상 목록 통과', () => {
    const items = [{ id: 1, qty: 2 }, { id: 3, qty: 1 }];
    expect(parseOrderItems(items)).toEqual({ ok: true, value: items });
  });
  it('빈 목록, 수량 0, 수량 100, 문자 id, 배열 아님 거부', () => {
    for (const v of [[], [{ id: 1, qty: 0 }], [{ id: 1, qty: 100 }], [{ id: '1', qty: 1 }], 'x'])
      expect(parseOrderItems(v).ok).toBe(false);
  });
});

describe('maskName', () => {
  it('3글자: 홍*동', () => expect(maskName('홍길동')).toBe('홍*동'));
  it('2글자: 홍*', () => expect(maskName('홍길')).toBe('홍*'));
  it('5글자: 남***아', () => expect(maskName('남궁민수아')).toBe('남***아'));
});