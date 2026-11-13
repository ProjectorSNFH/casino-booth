import { rpc } from '../db';
import { requireStaff } from '../guard';
import { handle } from '../http';

/** 스테이션 단위 동작(시작/종료/뒤로/정지): 토큰의 스테이션에만 적용 */
export function stationAction(fn: 'start_match' | 'end_match' | 'back_to_pick' | 'abort_match') {
  return handle(['POST'], async ({ req }) => {
    const staff = await requireStaff(req, 'game');
    const r = await rpc<{ vs?: string } | null>(fn, { p_station: staff.station });
    return fn === 'start_match' && r && typeof r === 'object' ? { vs: r.vs ?? null } : {};
  });
}
