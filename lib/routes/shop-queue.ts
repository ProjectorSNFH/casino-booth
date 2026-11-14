import { db } from '../db';
import { requireStaff } from '../guard';
import { handle } from '../http';

/** shp2: 배부 대기 주문(승인된 순서대로) */
export default handle(['GET'], async ({ req }) => {
  await requireStaff(req, 'shop_deliver');
  const { data, error } = await db()
    .from('orders')
    .select('id, card_id, items, total, approved_at')
    .eq('status', 'approved')
    .order('approved_at', { ascending: true });
  if (error) throw error;
  return {
    orders: ((data ?? []) as Array<Record<string, any>>).map((x) => ({
      id: Number(x.id), card_id: x.card_id, items: x.items, total: x.total,
    })),
  };
});
