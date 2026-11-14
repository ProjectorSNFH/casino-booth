import { db } from '../db';
import { requireParticipant } from '../guard';
import { handle } from '../http';

const OPEN = ['prep', 'playing', 'pick', 'review'];

type Row = Record<string, any>;
const must = <T,>(r: { data: T; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data;
};

/**
 * 참여자 화면 하나로 모은 상태: 내 카드(QR용 uid), 코인, 진행 중인 매치 칸, 주문, 마지막 정산.
 * 화면이 2~4초마다 부른다. 내 카드 한 장만 읽는다.
 */
export default handle(['GET'], async ({ req }) => {
  const me = await requireParticipant(req);
  const d = db();
  const id = me.card_id;

  const [card, bal, gl, ord, tl, lim] = await Promise.all([
    d.from('cards').select('id, uid, status, part, active_match_id').eq('id', id).maybeSingle(),
    d.from('card_balance').select('balance').eq('card_id', id).maybeSingle(),
    d.from('glist').select('game, n').eq('card_id', id),
    d.from('orders').select('id, status, total').eq('card_id', id).order('id', { ascending: false }).limit(1),
    d.from('tlist').select('id, at, content, coin_delta, kind').eq('card_id', id)
      .in('kind', ['RESULT', 'EXIT', 'BAN']).order('id', { ascending: false }).limit(10),
    d.from('config').select('value').eq('key', 'limits').maybeSingle(),
  ]);
  const c = must(card) as Row | null;
  if (!c) return { card: null };

  const plays = ((must(gl) ?? []) as Row[])
    .filter((g) => g.game !== 'SLOTMACHINE')
    .reduce((a, g) => a + Number(g.n ?? 0), 0);
  const order = ((must(ord) ?? []) as Row[])[0] ?? null;
  const logs = (must(tl) ?? []) as Row[];
  const lastResult = logs.find((x) => x.kind === 'RESULT') ?? null;
  const lastExit = logs.find((x) => x.kind === 'EXIT') ?? null;
  const limits = (must(lim) as Row | null)?.value as Row | undefined;

  let match: Record<string, unknown> | null = null;
  if (c.status === 'active' && c.active_match_id != null) {
    const [m, s] = await Promise.all([
      d.from('matches').select('id, game, vs, phase, win').eq('id', c.active_match_id).maybeSingle(),
      d.from('match_slots').select('slot, stage, bet, proposed_delta, acked_at')
        .eq('match_id', c.active_match_id).eq('card_id', id).maybeSingle(),
    ]);
    const mr = must(m) as Row | null;
    const sr = must(s) as Row | null;
    if (mr && sr && OPEN.includes(mr.phase)) {
      match = {
        id: Number(mr.id), game: mr.game, vs: mr.vs, phase: mr.phase,
        slot: sr.slot, stage: sr.stage, bet: sr.bet,
        proposed_delta: mr.phase === 'review' ? sr.proposed_delta : null,
        acked: sr.acked_at != null,
      };
    }
  }

  const exitReason = c.status === 'banned'
    ? 'ban'
    : c.status === 'done' && typeof lastExit?.content === 'string'
      ? (/^EXIT reason=([a-z_]+)$/.exec(lastExit.content)?.[1] ?? 'staff')
      : null;

  return {
    card: { id: c.id, uid: c.uid, status: c.status, part: c.part },
    balance: Number(((must(bal) as Row | null)?.balance) ?? 0),
    plays,
    shop_min_plays: Number(limits?.shop_min_plays ?? 2),
    match,
    order: order ? { id: Number(order.id), status: order.status, total: order.total } : null,
    last: lastResult
      ? { id: Number(lastResult.id), delta: lastResult.coin_delta, at: lastResult.at, content: lastResult.content }
      : null,
    exit_reason: exitReason,
  };
});
