-- 1) 스테이션 역할에 'event' 추가
alter table public.stations drop constraint if exists stations_role_check;
alter table public.stations add constraint stations_role_check
  check (role in ('issue','adjust','game','event','shop_approve','shop_deliver','hof'));

-- 2) GList에 이벤트 항목 추가
alter table public.glist drop constraint if exists glist_game_check;
alter table public.glist add constraint glist_game_check
  check (game in ('HALLIGALLI','SKEWER','CHAMCHAMCHAM','JOKER','RANDOMBALL','TABLESOCCER','SLOTMACHINE'));

-- 3) 슬롯 머신 기록은 카드당 한 번만
create unique index tlist_one_slot_event on public.tlist (card_id)
  where kind = 'EVENT' and content like 'EVENT SLOTMACHINE %';

-- 4) 스테이션과 설정 추가
insert into public.stations (code, role, game) values ('slt1', 'event', 'SLOTMACHINE')
on conflict (code) do nothing;

insert into public.config (key, value) values
  ('events', '{
    "SLOTMACHINE": {"name":"슬롯 머신", "max_plays":1, "rewards":[0,2,4,6,9,12], "counts_for_shop":false}
  }'::jsonb)
on conflict (key) do nothing;

-- 5) card_summary: 게임 참여 횟수에서 이벤트 제외, event_plays 추가
create or replace view public.card_summary with (security_invoker = on) as
select c.id,
       c.mask_name,
       c.part,
       c.status,
       c.created_at,
       c.activated_at,
       coalesce(b.balance, 0) as coins,
       coalesce((select sum(g.n) from public.glist g
                  where g.card_id = c.id and g.game <> 'SLOTMACHINE'), 0)::int as plays,
       (select m.game
          from public.match_slots s
          join public.matches m on m.id = s.match_id
         where s.card_id = c.id
           and m.phase in ('prep', 'playing', 'pick', 'review')
         limit 1) as current_game,
       coalesce((select sum(g.n) from public.glist g
                  where g.card_id = c.id and g.game = 'SLOTMACHINE'), 0)::int as event_plays
from public.cards c
left join public.card_balance b on b.card_id = c.id;