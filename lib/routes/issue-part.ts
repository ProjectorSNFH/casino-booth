import { rpc } from '../db';
import { ApiError } from '../errors';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { parsePart } from '../validate';

/** suc1: 회차 시작/종료. 종료하면 그 회차의 활성 카드가 퇴장 처리됨 (게임·주문 중인 카드는 끝난 뒤) */
export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'issue');
  const part = must(parsePart(body.part));
  if (body.status !== 'active' && body.status !== 'ended') throw new ApiError('BAD_STATUS');
  const r = await rpc<{ exited: number; deferred: number }>('set_part', { p_part: part, p_status: body.status });
  return { part, status: body.status, exited: r?.exited ?? 0, deferred: r?.deferred ?? 0 };
});
