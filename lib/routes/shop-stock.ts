import { db } from '../db';
import { ApiError } from '../errors';
import { posInt, requireStaff } from '../guard';
import { handle } from '../http';

/** shp1: 상품 판매/품절 전환 */
export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'shop_approve');
  const id = posInt(body.id, 9999);
  const status = body.status;
  if (id === null || (status !== 'on_sale' && status !== 'sold_out')) throw new ApiError('BAD_REQUEST');
  const { data, error } = await db().from('products').update({ status }).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new ApiError('BAD_ITEMS');
  return { id, status };
});
