alter table public.card_state
  add column if not exists match_id bigint,
  add column if not exists game     text,
  add column if not exists phase    text,
  add column if not exists stage    text,
  add column if not exists bet      int,
  add column if not exists delta    int,
  add column if not exists acked    boolean not null default false;

create or replace function public.refresh_card_state(p_card_id int) returns void
language plpgsql set search_path = public as $$
declare
  c public.cards%rowtype;
  v_mid bigint; v_game text; v_phase text; v_stage text; v_bet int; v_delta int; v_acked boolean;
  v_plays int; v_ev int; v_coins int;
begin
  select * into c from cards where id = p_card_id;
  if not found then return; end if;

  select m.id, m.game, m.phase, sl.stage, sl.bet, sl.proposed_delta, (sl.acked_at is not null)
    into v_mid, v_game, v_phase, v_stage, v_bet, v_delta, v_acked
    from match_slots sl join matches m on m.id = sl.match_id
   where sl.card_id = p_card_id and m.phase in ('prep','playing','pick','review')
   limit 1;

  v_coins := balance_of(c.id);
  select coalesce(sum(n) filter (where game <> 'SLOTMACHINE'), 0)::int,
         coalesce(sum(n) filter (where game = 'SLOTMACHINE'), 0)::int
    into v_plays, v_ev from glist where card_id = c.id;

  insert into card_state (card_id, status, token_version, coins, plays, event_plays,
                          match_id, game, phase, stage, bet, delta, acked)
  values (c.id, c.status, c.token_version, v_coins, v_plays, v_ev,
          v_mid, v_game, v_phase, v_stage, v_bet, v_delta, coalesce(v_acked, false))
  on conflict (card_id) do update
    set status = excluded.status, token_version = excluded.token_version,
        coins = excluded.coins, plays = excluded.plays, event_plays = excluded.event_plays,
        match_id = excluded.match_id, game = excluded.game, phase = excluded.phase,
        stage = excluded.stage, bet = excluded.bet, delta = excluded.delta,
        acked = excluded.acked, updated_at = now()
    where (card_state.status, card_state.token_version, card_state.coins, card_state.plays,
           card_state.event_plays, card_state.match_id, card_state.game, card_state.phase,
           card_state.stage, card_state.bet, card_state.delta, card_state.acked)
          is distinct from
          (excluded.status, excluded.token_version, excluded.coins, excluded.plays,
           excluded.event_plays, excluded.match_id, excluded.game, excluded.phase,
           excluded.stage, excluded.bet, excluded.delta, excluded.acked);
end $$;

create or replace function public.trg_card_state_slots() returns trigger
language plpgsql set search_path = public as $$
begin
  perform refresh_card_state(case when tg_op = 'DELETE' then old.card_id else new.card_id end);
  return null;
end $$;

create or replace function public.trg_card_state_matches() returns trigger
language plpgsql set search_path = public as $$
declare r record;
begin
  for r in select card_id from match_slots where match_id = new.id loop
    perform refresh_card_state(r.card_id);
  end loop;
  return null;
end $$;

create trigger card_state_slots after insert or update or delete
  on public.match_slots for each row execute function public.trg_card_state_slots();
create trigger card_state_matches after update of phase
  on public.matches for each row execute function public.trg_card_state_matches();