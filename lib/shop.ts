import { ApiError } from './errors';

export type OrderItem = { id: number; qty: number };

/** 상품 목록 검사: 1~20개 항목, id는 정수, qty는 1~99. 가격은 받지 않음 (DB가 계산) */
export function parseItems(v: unknown): OrderItem[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 20) throw new ApiError('BAD_ITEMS');
  return v.map((e) => {
    const o = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
    const id = typeof o.id === 'number' ? o.id : typeof o.id === 'string' && /^[0-9]{1,4}$/.test(o.id) ? Number(o.id) : NaN;
    const qty = typeof o.qty === 'number' ? o.qty : typeof o.qty === 'string' && /^[0-9]{1,2}$/.test(o.qty) ? Number(o.qty) : NaN;
    if (!Number.isInteger(id) || id < 1 || id > 9999 || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new ApiError('BAD_ITEMS');
    }
    return { id, qty };
  });
}
