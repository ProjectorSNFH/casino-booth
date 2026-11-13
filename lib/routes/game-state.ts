import { db } from '../db';
import { requireStaff } from '../guard';
import { handle } from '../http';

const OPEN = ['prep', 'playing', 'pick', 'review'];

/** 게임 스태프 화면: 내 스테이션의 진행 중인 매치와 칸 상태 (새로고침, 복구용) */
export default handle(['GET'], async ({ req }) => {
  const staff = await requireStaff(req, 'game');
  const d = db();

  const { data: m, error: e1 } = await d
    .from('matches')
    .select('id, game, vs, phase, win')
    .eq('station', staff.station)
    .in('phase', OPEN)
    .maybeSingle();
  if (e1) throw e1;
  if (!m) return { match: null, slots: [] };

  const { data: slots, error: e2 } = await d
    .from('match_slots')
    .select('slot, card_id, stage, bet, proposed_delta, acked_at')
    .eq('match_id', m.id);
  if (e2) throw e2;
  const rows = (slots ?? []) as Array<Record<string, any>>;
  const ids = rows.map((s) => s.card_id);

  let names = new Map<number, string>();
  let bal = new Map<number, number>();
  if (ids.length) {
    const [c, b] = await Promise.all([
      d.from('cards').select('id, mask_name').in('id', ids),
      d.from('card_balance').select('card_id, balance').in('card_id', ids),
    ]);
    if (c.error) throw c.error;
    if (b.error) throw b.error;
    names = new Map((c.data ?? []).map((x: any) => [x.id, x.mask_name]));
    bal = new Map((b.data ?? []).map((x: any) => [x.card_id, x.balance]));
  }

  return {
    match: { id: Number(m.id), game: m.game, vs: m.vs, phase: m.phase, win: m.win },
    slots: rows
      .map((s) => ({
        slot: s.slot,
        card_id: s.card_id,
        mask_name: names.get(s.card_id) ?? '',
        stage: s.stage,
        bet: s.bet,
        balance: bal.get(s.card_id) ?? 0,
        proposed_delta: s.proposed_delta,
        acked: s.acked_at != null,
      }))
      .sort((a, b) => a.slot - b.slot),
  };
});
