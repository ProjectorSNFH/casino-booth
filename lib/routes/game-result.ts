import { rpc } from '../db';
import { ApiError } from '../errors';
import { requireStaff } from '../guard';
import { handle } from '../http';

/** 결과 선택: 운영진 대결은 'W'/'L', 친구 대결은 이기는 칸 번호 0~3 */
export function parseWin(v: unknown): string | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3) return String(v);
  if (typeof v === 'string' && /^(W|L|[0-3])$/.test(v)) return v;
  return null;
}

export default handle(['POST'], async ({ req, body }) => {
  const staff = await requireStaff(req, 'game');
  const win = parseWin(body.win);
  if (win === null) throw new ApiError('BAD_RESULT');
  const results = await rpc<unknown[]>('set_result', { p_station: staff.station, p_win: win });
  return { results: Array.isArray(results) ? results : [] };
});
