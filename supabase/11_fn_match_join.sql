create or replace function public.balance_of(p_card_id int) returns int
language sql stable set search_path = public as $$
  select coalesce(sum(coin_delta), 0)::int from tlist where card_id = p_card_id
$$;

-- 스태프 📷: 카드를 매치 칸에 배정
create or replace function public.scan_card(p_station text, p_card_id int) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_st    public.stations%rowtype;
  v_card  public.cards%rowtype;
  v_m     public.matches%rowtype;
  v_game  jsonb;
  v_slots int;
  v_nobet boolean;
  v_slot  smallint;
  v_plays int;
  v_busy  text;
begin
  select * into v_st from stations where code = p_station and role = 'game' for update;
  if not found then raise exception 'STATION_MISSING'; end if;
  select value -> v_st.game into v_game from config where key = 'games';
  v_slots := (v_game ->> 'slots')::int;
  v_nobet := coalesce((v_game ->> 'nobet')::boolean, false);

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_card.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;

  select * into v_m from matches
   where station = p_station and phase in ('prep','playing','pick','review');
  if found and v_m.phase <> 'prep' then raise exception 'MATCH_STARTED'; end if;
  if found then   -- 같은 카드를 다시 찍은 경우: 기존 칸 그대로 반환
    select slot into v_slot from match_slots where match_id = v_m.id and card_id = p_card_id;
    if found then return jsonb_build_object('match_id', v_m.id, 'slot', v_slot); end if;
  end if;

  v_busy := card_busy(p_card_id);
  if v_busy is not null then raise exception '%', v_busy; end if;

  select coalesce(sum(n), 0) into v_plays from glist
   where card_id = p_card_id and game = v_st.game;
  if v_plays >= (v_game ->> 'max_plays')::int then raise exception 'PLAY_LIMIT'; end if;
  if balance_of(p_card_id) < coalesce((v_game ->> 'min_coins')::int, 1) then
    raise exception 'LOW_COINS';
  end if;

  if v_m.id is null then
    insert into matches (station, game, phase) values (p_station, v_st.game, 'prep')
    returning * into v_m;
  end if;

  select s into v_slot from generate_series(0, v_slots - 1) s
   where not exists (select 1 from match_slots where match_id = v_m.id and slot = s)
   order by s limit 1;
  if v_slot is null then raise exception 'MATCH_FULL'; end if;

  insert into match_slots (match_id, slot, card_id, stage, bet)
  values (v_m.id, v_slot, p_card_id,
          case when v_nobet then 'bet_set' else 'scanned' end,
          case when v_nobet then 0 end);
  update cards set active_match_id = v_m.id where id = p_card_id;

  return jsonb_build_object('match_id', v_m.id, 'slot', v_slot);
end $$;

-- 참여자: 베팅 금액 확정
create or replace function public.set_bet(p_card_id int, p_bet int) returns void
language plpgsql set search_path = public as $$
declare
  v_s    public.match_slots%rowtype;
  v_m    public.matches%rowtype;
  v_game jsonb;
begin
  select s.* into v_s from match_slots s join matches m on m.id = s.match_id
   where s.card_id = p_card_id and m.phase = 'prep' for update of s;
  if not found then raise exception 'NOT_IN_MATCH'; end if;
  select * into v_m from matches where id = v_s.match_id;
  select value -> v_m.game into v_game from config where key = 'games';
  if coalesce((v_game ->> 'nobet')::boolean, false) then raise exception 'NO_BET_GAME'; end if;
  if v_s.stage = 'ready' then raise exception 'ALREADY_READY'; end if;
  if p_bet is null or p_bet < 1 or p_bet > balance_of(p_card_id) then raise exception 'BAD_BET'; end if;
  update match_slots set bet = p_bet, stage = 'bet_set', proposed_delta = null
   where match_id = v_s.match_id and slot = v_s.slot;
end $$;

-- 스태프 ✓
create or replace function public.accept_slot(p_match_id bigint, p_slot int) returns void
language plpgsql set search_path = public as $$
declare
  v_s    public.match_slots%rowtype;
  v_m    public.matches%rowtype;
  v_game jsonb;
begin
  select * into v_m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  select * into v_s from match_slots where match_id = p_match_id and slot = p_slot for update;
  if not found then raise exception 'NO_SLOT'; end if;
  if v_s.stage = 'ready' then return; end if;
  if v_m.phase <> 'prep' then raise exception 'MATCH_STARTED'; end if;
  if v_s.stage <> 'bet_set' then raise exception 'BET_NOT_SET'; end if;
  select value -> v_m.game into v_game from config where key = 'games';
  if not coalesce((v_game ->> 'nobet')::boolean, false)
     and v_s.bet > balance_of(v_s.card_id) then
    raise exception 'BET_OVER_BALANCE';
  end if;
  update match_slots set stage = 'ready' where match_id = p_match_id and slot = p_slot;
end $$;

-- 스태프 ✕
create or replace function public.reject_slot(p_match_id bigint, p_slot int) returns void
language plpgsql set search_path = public as $$
declare
  v_s public.match_slots%rowtype;
  v_m public.matches%rowtype;
begin
  select * into v_m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  select * into v_s from match_slots where match_id = p_match_id and slot = p_slot for update;
  if not found then return; end if;
  if v_m.phase <> 'prep' then raise exception 'MATCH_STARTED'; end if;
  delete from match_slots where match_id = p_match_id and slot = p_slot;
  update cards set active_match_id = null where id = v_s.card_id;
end $$;

-- 참여자 "취소" (준비 완료 전에만)
create or replace function public.leave_slot(p_card_id int) returns void
language plpgsql set search_path = public as $$
declare v_s public.match_slots%rowtype;
begin
  select s.* into v_s from match_slots s join matches m on m.id = s.match_id
   where s.card_id = p_card_id and m.phase = 'prep' for update of s;
  if not found then return; end if;
  if v_s.stage = 'ready' then raise exception 'ALREADY_READY'; end if;
  delete from match_slots where match_id = v_s.match_id and slot = v_s.slot;
  update cards set active_match_id = null where id = p_card_id;
end $$;

-- 서버(service_role)만 실행 가능
revoke execute on function public.balance_of(int)             from public, anon, authenticated;
revoke execute on function public.scan_card(text,int)         from public, anon, authenticated;
revoke execute on function public.set_bet(int,int)            from public, anon, authenticated;
revoke execute on function public.accept_slot(bigint,int)     from public, anon, authenticated;
revoke execute on function public.reject_slot(bigint,int)     from public, anon, authenticated;
revoke execute on function public.leave_slot(int)             from public, anon, authenticated;
grant  execute on function public.balance_of(int)             to service_role;
grant  execute on function public.scan_card(text,int)         to service_role;
grant  execute on function public.set_bet(int,int)            to service_role;
grant  execute on function public.accept_slot(bigint,int)     to service_role;
grant  execute on function public.reject_slot(bigint,int)     to service_role;
grant  execute on function public.leave_slot(int)             to service_role;