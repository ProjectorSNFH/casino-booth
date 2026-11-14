import { db } from '../db';
import { requireStaff } from '../guard';
import { handle } from '../http';

/** shp1: 승인 대기 주문(오래된 순)과 상품 재고 */
export default handle(['GET'], async ({ req }) => {
  await requireStaff(req, 'shop_approve');
  const d = db();
  const [o, p] = await Promise.all([
    d.from('orders').select('id, card_id, items, total, created_at').eq('status', 'pending').order('created_at', { ascending: true }),
    d.from('products').select('id, name, price, status').order('sort', { ascending: true }),
  ]);
  if (o.error) throw o.error;
  if (p.error) throw p.error;
  const orders = (o.data ?? []) as Array<Record<string, any>>;

  let bal = new Map<number, number>();
  if (orders.length) {
    const b = await d.from('card_balance').select('card_id, balance').in('card_id', orders.map((x) => x.card_id));
    if (b.error) throw b.error;
    bal = new Map((b.data ?? []).map((x: any) => [x.card_id, x.balance]));
  }
  return {
    orders: orders.map((x) => ({
      id: Number(x.id), card_id: x.card_id, items: x.items, total: x.total, balance: bal.get(x.card_id) ?? 0,
    })),
    products: p.data ?? [],
  };
});
