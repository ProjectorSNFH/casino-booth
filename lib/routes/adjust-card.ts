import { db } from '../db';
import { ApiError } from '../errors';
import { must, requireStaff } from '../guard';
import { handle } from '../http';
import { parseCardId } from '../validate';

/** suc2: 카드의 코인 기록(TList), 게임 횟수(GList), 잔고, 최대 보유치 */
export default handle(['POST'], async ({ req, body }) => {
  await requireStaff(req, 'adjust');
  const cardId = must(parseCardId(body.card_id));
  const d = db();
  const [c, t, g] = await Promise.all([
    d.from('cards').select('id, mask_name, status').eq('id', cardId).maybeSingle(),
    d.from('tlist').select('id, at, content, coin_delta, kind').eq('card_id', cardId).order('at', { ascending: true }).order('id', { ascending: true }),
    d.from('glist').select('game, n').eq('card_id', cardId),
  ]);
  if (c.error) throw c.error;
  if (t.error) throw t.error;
  if (g.error) throw g.error;
  if (!c.data) throw new ApiError('NOT_FOUND');

  const rows = (t.data ?? []) as Array<{ id: number; at: string; content: string; coin_delta: number; kind: string }>;
  let run = 0;
  let peak = 0;
  const tlist = rows.map((r, i) => {
    run += r.coin_delta;
    if (i === 0 || run > peak) peak = run;
    return { id: Number(r.id), at: r.at, content: r.content, coin_delta: r.coin_delta, kind: r.kind, running: run };
  });
  return {
    card: { id: c.data.id, mask_name: c.data.mask_name, status: c.data.status },
    balance: run,
    peak: rows.length ? peak : 0,
    tlist,
    glist: g.data ?? [],
  };
});
