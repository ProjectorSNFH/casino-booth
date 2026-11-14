import { ApiError } from './errors';
import { db } from './db';

export const GAME_KEYS = ['HALLIGALLI', 'SKEWER', 'CHAMCHAMCHAM', 'JOKER', 'RANDOMBALL', 'TABLESOCCER'] as const;
export type GameKey = (typeof GAME_KEYS)[number];

const intIn = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?[0-9]{1,6}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** 코인 변화량: 정수 -1000 ~ 1000 */
export function parseDelta(v: unknown): number {
  const n = intIn(v, -1000, 1000);
  if (n === null) throw new ApiError('BAD_REQUEST');
  return n;
}
/** 기록 번호 */
export function parseRowId(v: unknown): number {
  const n = intIn(v, 1, 2_000_000_000);
  if (n === null) throw new ApiError('BAD_REQUEST');
  return n;
}
/** 사유/내용: 공백 정리 후 1~60자(내용은 120자) */
export function parseText(v: unknown, max = 60): string {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length < 1 || s.length > max || /[\u0000-\u001f]/.test(s)) throw new ApiError('BAD_REQUEST');
  return s;
}
export function parseGame(v: unknown): GameKey {
  if (typeof v === 'string' && (GAME_KEYS as readonly string[]).includes(v)) return v as GameKey;
  throw new ApiError('BAD_REQUEST');
}
/** 게임 참여 횟수: 0~99 */
export function parseCount(v: unknown): number {
  const n = intIn(v, 0, 99);
  if (n === null) throw new ApiError('BAD_REQUEST');
  return n;
}

export async function cardExists(cardId: number): Promise<void> {
  const { data, error } = await db().from('cards').select('id').eq('id', cardId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError('NOT_FOUND');
}

export async function balanceOf(cardId: number): Promise<number> {
  const { data, error } = await db().from('card_balance').select('balance').eq('card_id', cardId).maybeSingle();
  if (error) throw error;
  return data ? Number(data.balance) : 0;
}

/** 고친 뒤 잔고가 음수가 되면 거부 (정산 중 BALANCE_CHANGED 사고 방지) */
export function assertBalanceOk(after: number): void {
  if (after < 0) throw new ApiError('BALANCE_LOW');
}

export async function getTRow(id: number): Promise<{ id: number; card_id: number; coin_delta: number }> {
  const { data, error } = await db().from('tlist').select('id, card_id, coin_delta').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError('NOT_FOUND');
  return data as { id: number; card_id: number; coin_delta: number };
}
