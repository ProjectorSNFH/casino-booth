import { rpc } from '../db';
import { ApiError } from '../errors';
import { posInt, requireStaff } from '../guard';
import { handle } from '../http';

type Role = 'shop_approve' | 'shop_deliver';

/** 주문 번호를 받는 스태프 동작(승인/거절/배부) 공통 */
export function orderAction(role: Role, fn: 'approve_order' | 'reject_order' | 'deliver_order') {
  return handle(['POST'], async ({ req, body }) => {
    await requireStaff(req, role);
    const id = posInt(body.order_id);
    if (id === null) throw new ApiError('BAD_REQUEST');
    const r = await rpc<Record<string, unknown> | null>(fn, { p_order_id: id });
    return { order_id: id, ...(fn === 'approve_order' && r && typeof r === 'object' ? r : {}) };
  });
}
