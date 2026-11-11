import { describe, expect, it, vi } from 'vitest';
import { ApiError, ERRORS, fromDb, isErrorCode, toResponse } from '../lib/errors';

// DB 함수(supabase/*.sql)가 raise exception 으로 내는 코드 전부
const DB_CODES = [
  'STATION_MISSING', 'ISSUE_BUSY', 'PART_ENDED', 'ACTIVE_FULL', 'PART_FULL', 'DUPLICATE_SID',
  'NOT_ISSUED', 'IN_USE', 'CLAIM_CONFLICT', 'SESSION_NAME_TAKEN', 'NOT_CURRENT', 'NO_CLAIM',
  'CLAIM_EXPIRED', 'NOT_FOUND', 'NOT_ACTIVE', 'CLAIM_CLOSED', 'IN_MATCH', 'BAD_REASON',
  'BAD_STATUS', 'BAD_PART', 'MATCH_STARTED', 'PENDING_ORDER', 'PLAY_LIMIT', 'LOW_COINS',
  'MATCH_FULL', 'NOT_IN_MATCH', 'NO_BET_GAME', 'ALREADY_READY', 'BAD_BET', 'NO_MATCH',
  'NO_SLOT', 'BET_NOT_SET', 'BET_OVER_BALANCE', 'PENDING_SLOTS', 'NO_PLAYERS', 'BAD_PHASE',
  'BAD_RESULT', 'NO_RESULT', 'WINNER_GONE', 'BALANCE_CHANGED', 'NOT_ENOUGH_PLAYS',
  'BAD_ITEMS', 'SOLD_OUT', 'OVER_BALANCE', 'NO_ORDER', 'ORDER_CLOSED', 'BALANCE_LOW',
  'NOT_APPROVED', 'BAD_REWARD', 'ALREADY_PLAYED',
];

describe('ERRORS 표', () => {
  it('모든 항목에 상태와 문구가 있다', () => {
    for (const [code, e] of Object.entries(ERRORS)) {
      expect(e.message.length, code).toBeGreaterThan(0);
      expect(Number.isInteger(e.status), code).toBe(true);
    }
  });
  it('상태는 정해진 값뿐', () => {
    const allowed = new Set([400, 401, 403, 404, 405, 409, 429, 500]);
    for (const [code, e] of Object.entries(ERRORS)) expect(allowed.has(e.status), code).toBe(true);
  });
});

describe('DB 함수가 내는 코드', () => {
  it('전부 표에 있다', () => {
    for (const c of DB_CODES) expect(isErrorCode(c), c).toBe(true);
  });
});

describe('fromDb', () => {
  it('알려진 코드', () => {
    expect(fromDb({ message: 'PART_ENDED' }).code).toBe('PART_ENDED');
  });
  it('상세 설명을 같이 담는다', () => {
    const e = fromDb({ message: 'SOLD_OUT', details: '마카로니' });
    expect(e.code).toBe('SOLD_OUT');
    expect(e.detail).toBe('마카로니');
  });
  it('모르는 문구는 INTERNAL', () => {
    expect(fromDb({ message: 'relation "x" does not exist' }).code).toBe('INTERNAL');
  });
  it('앞뒤 공백은 무시', () => {
    expect(fromDb({ message: ' NOT_ISSUED ' }).code).toBe('NOT_ISSUED');
  });
});

describe('toResponse', () => {
  it('ApiError를 응답으로 바꾼다', () => {
    expect(toResponse(new ApiError('NOT_ISSUED'))).toEqual({
      status: 404,
      body: { ok: false, code: 'NOT_ISSUED', message: '발급되지 않은 번호입니다.' },
    });
  });
  it('SOLD_OUT은 상품 이름을 보낸다', () => {
    expect(toResponse(new ApiError('SOLD_OUT', '마카로니')).body.detail).toBe('마카로니');
  });
  it('다른 코드의 상세는 숨긴다', () => {
    expect(toResponse(new ApiError('PART_ENDED', '내부 정보')).body).not.toHaveProperty('detail');
  });
  it('DB 오류 객체를 바꾼다', () => {
    const r = toResponse({ message: 'PART_ENDED', details: null });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PART_ENDED');
  });
  it('모르는 오류는 500이고 원문을 노출하지 않는다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = toResponse(new Error('connection to 10.0.0.5 refused'));
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('INTERNAL');
    expect(JSON.stringify(r.body)).not.toContain('10.0.0.5');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('ApiError', () => {
  it('코드에서 상태가 정해진다', () => {
    expect(new ApiError('BAD_SID').status).toBe(400);
    expect(new ApiError('UNAUTHORIZED').status).toBe(401);
    expect(new ApiError('NOT_ISSUED').status).toBe(404);
    expect(new ApiError('PART_ENDED').status).toBe(409);
    expect(new ApiError('RATE_LIMITED').status).toBe(429);
  });
  it('Error로도 쓸 수 있다', () => {
    const e = new ApiError('PLAY_LIMIT');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('PLAY_LIMIT');
  });
});