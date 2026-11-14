import { cacheGet, cacheSet } from '../cache';
import { db } from '../db';
import { requireStaff } from '../guard';
import { handle } from '../http';

const KEY = 'hof:v1';
const TTL_SEC = 10;
const MAX_ROWS = 100;

type Row = { rank: number; card_id: number; n: string; v: number };
type Snapshot = { generated_at: string; ranks: Row[] };

/** tbs1 TV: 명예의 전당. 순위값 = 최대 보유치, 이용 제한 제외, 퇴장자 포함. Redis에 10초 캐시 */
export default handle(['GET'], async ({ req }) => {
  await requireStaff(req, 'hof');

  const hit = await cacheGet<Snapshot>(KEY);
  if (hit && Array.isArray(hit.ranks)) return { ...hit, cached: true };

  const { data, error } = await db()
    .from('hof_rank')
    .select('rank, card_id, mask_name, peak')
    .order('rank', { ascending: true })
    .limit(MAX_ROWS);
  if (error) throw error;

  const snap: Snapshot = {
    generated_at: new Date().toISOString(),
    ranks: ((data ?? []) as Array<Record<string, any>>).map((r) => ({
      rank: Number(r.rank), card_id: r.card_id, n: r.mask_name, v: r.peak,
    })),
  };
  await cacheSet(KEY, snap, TTL_SEC);
  return { ...snap, cached: false };
});
