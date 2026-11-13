import { db } from '../db';
import { requireStaff } from '../guard';
import { handle } from '../http';

/** 발급 데스크 화면을 처음 열거나 새로고침할 때 현재 상태를 한 번에 복원 */
export default handle(['GET'], async ({ req }) => {
  await requireStaff(req, 'issue');
  const sb = db();
  const [st, cfg, cards, claims] = await Promise.all([
    sb.from('stations').select('current_card_id').eq('code', 'suc1').single(),
    sb.from('config').select('key, value').in('key', ['parts', 'limits']),
    sb.from('cards').select('id, part, status, mask_name'),
    sb.from('claims').select('id, card_id, kind, session_name, expires_at').is('closed_at', null),
  ]);
  for (const r of [st, cfg, cards, claims]) if (r.error) throw r.error;

  const now = Date.now();
  const conf = Object.fromEntries((cfg.data ?? []).map((r: any) => [r.key, r.value]));
  const rows: any[] = cards.data ?? [];
  const open = (claims.data ?? []).map((c: any) => ({ ...c, expired: Date.parse(c.expires_at) < now }));

  const cur: number | null = st.data?.current_card_id ?? null;
  const curCard = cur == null ? null : rows.find((c) => c.id === cur) ?? null;
  const issueClaim = open.find((c: any) => c.kind === 'issue' && c.card_id === cur);

  return {
    pending: curCard
      ? {
          card_id: curCard.id,
          part: curCard.part,
          mask_name: curCard.mask_name,
          claim: issueClaim
            ? { id: issueClaim.id, session_name: issueClaim.session_name, expired: issueClaim.expired }
            : null,
        }
      : null,
    parts: conf.parts ?? {},
    limits: conf.limits ?? {},
    counts: {
      issued: {
        1: rows.filter((c) => c.part === 1).length,
        2: rows.filter((c) => c.part === 2).length,
      },
      active: rows.filter((c) => c.status === 'active').length,
    },
    reconnects: open
      .filter((c: any) => c.kind === 'reconnect' && !c.expired)
      .map((c: any) => ({ claim_id: c.id, card_id: c.card_id, session_name: c.session_name })),
  };
});
