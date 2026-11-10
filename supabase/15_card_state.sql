create table public.card_state (
  card_id       int primary key references public.cards(id) on delete cascade,
  status        text not null,
  token_version int not null,
  coins         int not null default 0,
  plays         int not null default 0,
  event_plays   int not null default 0,
  updated_at    timestamptz not null default now()
);
alter table public.card_state enable row level security;
revoke all on public.card_state from anon, authenticated;

create or replace function public.refresh_card_state(p_card_id int) returns void
language plpgsql set search_path = public as $$
declare c public.cards%rowtype;
begin
  select * into c from cards where id = p_card_id;
  if not found then return; end if;
  insert into card_state (card_id, status, token_version, coins, plays, event_plays)
  values (c.id, c.status, c.token_version, balance_of(c.id),
          coalesce((select sum(n) from glist where card_id = c.id and game <> 'SLOTMACHINE'), 0)::int,
          coalesce((select sum(n) from glist where card_id = c.id and game = 'SLOTMACHINE'), 0)::int)
  on conflict (card_id) do update
    set status = excluded.status, token_version = excluded.token_version,
        coins = excluded.coins, plays = excluded.plays,
        event_plays = excluded.event_plays, updated_at = now()
    where (card_state.status, card_state.token_version, card_state.coins,
           card_state.plays, card_state.event_plays)
          is distinct from
          (excluded.status, excluded.token_version, excluded.coins,
           excluded.plays, excluded.event_plays);
end $$;

create or replace function public.trg_card_state_cards() returns trigger
language plpgsql set search_path = public as $$
begin perform refresh_card_state(new.id); return null; end $$;

create or replace function public.trg_card_state_rows() returns trigger
language plpgsql set search_path = public as $$
begin
  perform refresh_card_state(case when tg_op = 'DELETE' then old.card_id else new.card_id end);
  return null;
end $$;

create trigger card_state_cards after insert or update of status, token_version
  on public.cards for each row execute function public.trg_card_state_cards();
create trigger card_state_tlist after insert or update or delete
  on public.tlist for each row execute function public.trg_card_state_rows();
create trigger card_state_glist after insert or update or delete
  on public.glist for each row execute function public.trg_card_state_rows();