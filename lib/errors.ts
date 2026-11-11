export type ErrorInfo = { status: number; message: string };

export const ERRORS = {
  // 요청 형식
  BAD_REQUEST:   { status: 400, message: '요청 형식이 올바르지 않습니다.' },
  BAD_SID:       { status: 400, message: '학번은 숫자 5자리로 입력해주세요.' },
  BAD_NAME:      { status: 400, message: '이름은 한글 2~5자로 입력해주세요.' },
  BAD_PART:      { status: 400, message: '회차 값이 올바르지 않습니다.' },
  BAD_CARD_ID:   { status: 400, message: '식별번호가 올바르지 않습니다.' },
  BAD_BET:       { status: 400, message: '베팅 금액이 올바르지 않습니다.' },
  BAD_STATION:   { status: 400, message: '유효하지 않은 코드입니다.' },
  BAD_ITEMS:     { status: 400, message: '상품 선택이 올바르지 않습니다.' },
  BAD_REASON:    { status: 400, message: '요청 값이 올바르지 않습니다.' },
  BAD_STATUS:    { status: 400, message: '요청 값이 올바르지 않습니다.' },
  BAD_RESULT:    { status: 400, message: '결과 선택이 올바르지 않습니다.' },
  BAD_REWARD:    { status: 400, message: '선택할 수 없는 금액입니다.' },

  // 인증
  UNAUTHORIZED:  { status: 401, message: '로그인이 필요합니다.' },
  STALE_TOKEN:   { status: 401, message: '다른 기기에서 연결되어 이 기기의 이용이 종료되었습니다.' },
  WRONG_PIN:     { status: 401, message: 'PIN이 일치하지 않습니다.' },
  FORBIDDEN:     { status: 403, message: '권한이 없습니다.' },

  // 못 찾음
  NOT_FOUND:     { status: 404, message: '카드를 찾을 수 없습니다.' },
  NOT_ISSUED:    { status: 404, message: '발급되지 않은 번호입니다.' },
  INFO_MISMATCH: { status: 404, message: '정보가 일치하지 않습니다.' },
  NO_MATCH:      { status: 404, message: '진행 중인 게임이 없습니다.' },
  NO_SLOT:       { status: 404, message: '해당 참여자 칸이 없습니다.' },
  NO_ORDER:      { status: 404, message: '주문을 찾을 수 없습니다.' },
  NO_CLAIM:      { status: 404, message: '확인할 요청이 없습니다.' },
  NOT_IN_MATCH:  { status: 404, message: '게임에 참여 중이 아닙니다.' },
  METHOD_NOT_ALLOWED: { status: 405, message: '허용되지 않는 요청 방식입니다.' },

  // 상태가 맞지 않음
  IN_USE:            { status: 409, message: '이미 사용 중인 번호입니다.' },
  CLAIM_CONFLICT:    { status: 409, message: '동시 요청이 감지되었습니다.' },
  SESSION_NAME_TAKEN:{ status: 409, message: '잠시 후 다시 시도해주세요.' },
  CLAIM_CLOSED:      { status: 409, message: '이미 처리된 요청입니다.' },
  CLAIM_EXPIRED:     { status: 409, message: '요청 시간이 지났습니다. 처음부터 다시 진행해주세요.' },
  ISSUE_BUSY:        { status: 409, message: '이미 처리 중인 발급이 있습니다.' },
  NOT_CURRENT:       { status: 409, message: '지금 처리 중인 발급이 아닙니다.' },
  PART_ENDED:        { status: 409, message: '이 회차는 종료되었습니다.' },
  PART_FULL:         { status: 409, message: '이 회차의 발급 인원 제한에 도달했습니다.' },
  ACTIVE_FULL:       { status: 409, message: '현재 활성 인원이 가득 찼습니다.' },
  DUPLICATE_SID:     { status: 409, message: '이미 등록된 학번입니다.' },
  NOT_ACTIVE:        { status: 409, message: '이용할 수 없는 카드입니다.' },
  IN_MATCH:          { status: 409, message: '다른 게임에 참여 중입니다.' },
  PENDING_ORDER:     { status: 409, message: '상품 주문 승인 대기 중입니다.' },
  MATCH_STARTED:     { status: 409, message: '이미 시작된 게임입니다.' },
  MATCH_FULL:        { status: 409, message: '참여 인원이 가득 찼습니다.' },
  PLAY_LIMIT:        { status: 409, message: '이 게임에 참여 횟수 제한을 도달했습니다.' },
  LOW_COINS:         { status: 409, message: '코인이 부족합니다.' },
  NO_BET_GAME:       { status: 409, message: '베팅이 없는 게임입니다.' },
  ALREADY_READY:     { status: 409, message: '이미 준비가 완료되었습니다.' },
  BET_NOT_SET:       { status: 409, message: '아직 베팅 금액이 정해지지 않았습니다.' },
  BET_OVER_BALANCE:  { status: 409, message: '베팅 금액이 보유 코인보다 많습니다.' },
  PENDING_SLOTS:     { status: 409, message: '준비가 끝나지 않은 참여자가 있습니다.' },
  NO_PLAYERS:        { status: 409, message: '준비된 참여자가 없습니다.' },
  BAD_PHASE:         { status: 409, message: '지금 할 수 없는 단계입니다.' },
  NO_RESULT:         { status: 409, message: '결과가 선택되지 않았습니다.' },
  WINNER_GONE:       { status: 409, message: '승자가 게임에서 빠졌습니다. 결과를 다시 선택해주세요.' },
  BALANCE_CHANGED:   { status: 409, message: '보유 코인이 바뀌어 정산할 수 없습니다. 결과를 확인해주세요.' },
  NOT_ENOUGH_PLAYS:  { status: 409, message: '게임을 2회 이상 참여해야 주문할 수 있습니다.' },
  SOLD_OUT:          { status: 409, message: '품절된 상품이 있습니다.' },
  OVER_BALANCE:      { status: 409, message: '보유한 코인보다 많습니다.' },
  BALANCE_LOW:       { status: 409, message: '보유 코인이 부족합니다.' },
  ORDER_CLOSED:      { status: 409, message: '이미 처리된 주문입니다.' },
  NOT_APPROVED:      { status: 409, message: '승인되지 않은 주문입니다.' },
  ALREADY_PLAYED:    { status: 409, message: '이미 참여한 이벤트입니다.' },

  // 횟수 제한, 서버 문제
  RATE_LIMITED:   { status: 429, message: '시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },
  STATION_MISSING:{ status: 500, message: '스테이션 설정을 찾을 수 없습니다.' },
  INTERNAL:       { status: 500, message: '오류가 발생했습니다. 잠시 후 다시 시도해주세요.' },
} as const satisfies Record<string, ErrorInfo>;

export type ErrorCode = keyof typeof ERRORS;

export const isErrorCode = (s: unknown): s is ErrorCode =>
  typeof s === 'string' && Object.hasOwn(ERRORS, s);

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, readonly detail?: string) {
    super(code);
    this.status = ERRORS[code].status;
  }
}

/** Supabase rpc 오류: message에 DB 함수가 낸 코드가 들어 있음 */
export function fromDb(err: { message?: unknown; details?: unknown }): ApiError {
  const m = typeof err.message === 'string' ? err.message.trim() : '';
  const d = typeof err.details === 'string' && err.details ? err.details : undefined;
  return isErrorCode(m) ? new ApiError(m, d) : new ApiError('INTERNAL');
}

const PUBLIC_DETAIL = new Set<ErrorCode>(['SOLD_OUT']);

export type ErrorBody = { ok: false; code: ErrorCode; message: string; detail?: string };

/** 무엇이 던져졌든 안전한 응답으로 바꿈 */
export function toResponse(e: unknown): { status: number; body: ErrorBody } {
  let err: ApiError;
  if (e instanceof ApiError) err = e;
  else if (typeof e === 'object' && e !== null && 'message' in e) err = fromDb(e);
  else err = new ApiError('INTERNAL');

  if (err.code === 'INTERNAL') console.error('[internal]', e); // 서버 로그에만 남김

  return {
    status: err.status,
    body: {
      ok: false,
      code: err.code,
      message: ERRORS[err.code].message,
      ...(err.detail && PUBLIC_DETAIL.has(err.code) ? { detail: err.detail } : {}),
    },
  };
}