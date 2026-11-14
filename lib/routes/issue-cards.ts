import { db } from '../db';
import { requireStaff } from '../guard';
import { handle } from '../http';

/** suc1: 전체 카드 표 (이름은 가린 상태). 최대 999장 */
export default handle(['GET'], async ({ req }) => {
  await requireStaff(req, 'issue');
  const { data, error } = await db()
    .from('card_summary')
    .select('id, mask_name, part, status, coins, plays, current_game, created_at, activated_at')
    .order('id', { ascending: true })
    .limit(999);
  if (error) throw error;
  return {
    cards: ((data ?? []) as Array<Record<string, any>>).map((c) => ({
      id: c.id, name: c.mask_name, part: c.part, status: c.status, coins: c.coins,
      plays: c.plays, game: c.current_game ?? null, at: c.activated_at ?? c.created_at,
    })),
  };
});
