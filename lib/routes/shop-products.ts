import { db } from '../db';
import { requireParticipant } from '../guard';
import { handle } from '../http';

/** 참여자: 상품 목록과 품절 여부 (화면이 5초마다 다시 불러 품절을 반영) */
export default handle(['GET'], async ({ req }) => {
  await requireParticipant(req);
  const { data, error } = await db()
    .from('products')
    .select('id, name, price, status')
    .order('sort', { ascending: true });
  if (error) throw error;
  return { products: data ?? [] };
});
