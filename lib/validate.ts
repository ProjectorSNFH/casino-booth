export type Parsed<T> = { ok: true; value: T } | { ok: false; code: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (code: string): Parsed<never> => ({ ok: false, code });

/** 스테이션 코드 → 역할. DB stations 표와 같아야 함 */
export const STATION_ROLES = {
  suc1: 'issue',
  suc2: 'adjust',
  hg21: 'game',
  stm1: 'game',
  ayh1: 'game',
  jks1: 'game',
  rdb1: 'game',
  rtc1: 'game',
  slt1: 'event',
  shp1: 'shop_approve',
  shp2: 'shop_deliver',
  tbs1: 'hof',
} as const;
export type StationCode = keyof typeof STATION_ROLES;

export function parseSid(v: unknown): Parsed<string> {
  return typeof v === 'string' && /^[0-9]{5}$/.test(v) ? ok(v) : bad('BAD_SID');
}

export function parseName(v: unknown): Parsed<string> {
  const s = typeof v === 'string' ? v.normalize('NFC') : '';
  return /^[가-힣]{2,5}$/.test(s) ? ok(s) : bad('BAD_NAME');
}

export function parsePart(v: unknown): Parsed<1 | 2> {
  if (v === 1 || v === '1') return ok<1 | 2>(1);
  if (v === 2 || v === '2') return ok<1 | 2>(2);
  return bad('BAD_PART');
}

/** 식별번호: 47 또는 '047' */
export function parseCardId(v: unknown): Parsed<number> {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && /^[0-9]{1,3}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 999 ? ok(n) : bad('BAD_CARD_ID');
}

export function parseBet(v: unknown): Parsed<number> {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 9999 ? ok(v) : bad('BAD_BET');
}

export function parseStation(v: unknown): Parsed<StationCode> {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return Object.hasOwn(STATION_ROLES, s) ? ok(s as StationCode) : bad('BAD_STATION');
}

export function parseOrderItems(v: unknown): Parsed<{ id: number; qty: number }[]> {
  if (!Array.isArray(v) || v.length < 1 || v.length > 10) return bad('BAD_ITEMS');
  const out: { id: number; qty: number }[] = [];
  for (const e of v) {
    const { id, qty } = (e ?? {}) as { id?: unknown; qty?: unknown };
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > 999) return bad('BAD_ITEMS');
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 99) return bad('BAD_ITEMS');
    out.push({ id, qty });
  }
  return ok(out);
}

/** 홍길동 → 홍*동, 홍길 → 홍*, 남궁민수아 → 남***아 */
export function maskName(name: string): string {
  const c = [...name];
  return c.length <= 2 ? c[0] + '*' : c[0] + '*'.repeat(c.length - 2) + c[c.length - 1];
}