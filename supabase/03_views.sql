-- ===== 1) 매 기록 시점의 누적 잔고 =====
create view public.tlist_running with (security_invoker = on) as
select t.*,
       sum(t.coin_delta) over (partition by t.card_id order by t.at, t.id) as running
from public.tlist t;

-- ===== 2) 카드별 현재 잔고 =====
create view public.card_balance with (security_invoker = on) as
select c.id as card_id,
       coalesce(sum(t.coin_delta), 0)::int as balance
from public.cards c
left join public.tlist t on t.card_id = c.id
group by c.id;

-- ===== 3) 카드별 최대 보유치(+처음 도달한 시각) =====
create view public.card_peak with (security_invoker = on) as
with p as (
  select card_id, max(running) as peak
  from public.tlist_running
  group by card_id
)
select p.card_id,
       p.peak::int as peak,
       (select min(r.at)
          from public.tlist_running r
         where r.card_id = p.card_id and r.running = p.peak) as reached_at
from p;

-- ===== 4) 명예의 전당 순위 (이용 제한자 제외, 퇴장자 포함) =====
create view public.hof_rank with (security_invoker = on) as
select row_number() over (order by k.peak desc, k.reached_at asc, c.id asc)::int as rank,
       c.id as card_id,
       c.mask_name,
       k.peak
from public.cards c
join public.card_peak k on k.card_id = c.id
where c.status in ('active', 'done');

-- ===== 5) 카드 요약 (발급 데스크 표, 상품 주문 조건용) =====
create view public.card_summary with (security_invoker = on) as
select c.id,
       c.mask_name,
       c.part,
       c.status,
       c.created_at,
       c.activated_at,
       coalesce(b.balance, 0) as coins,
       coalesce((select sum(g.n) from public.glist g where g.card_id = c.id), 0)::int as plays,
       (select m.game
          from public.match_slots s
          join public.matches m on m.id = s.match_id
         where s.card_id = c.id
           and m.phase in ('prep', 'playing', 'pick', 'review')
         limit 1) as current_game
from public.cards c
left join public.card_balance b on b.card_id = c.id;

-- ===== 6) 공개용 키로는 읽지 못하게 권한 회수 =====
revoke all on public.tlist_running, public.card_balance, public.card_peak,
              public.hof_rank, public.card_summary
  from anon, authenticated;