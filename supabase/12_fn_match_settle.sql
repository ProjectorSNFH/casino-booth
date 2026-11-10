-- 정산 계산 (규칙은 config에서 읽음)
create or replace function public.calc_deltas(p_match_id bigint)
returns table(r_slot smallint, r_card int, r_bet int, r_delta int)
language plpgsql set search_path = public as $$
declare
  v_m public.matches%rowtype;
  v_g jsonb;
  v_nobet boolean;
  v_mult numeric;
  v_others int;
begin
  select * into v_m from matches where id = p_match_id;
  if v_m.win is null then raise exception 'NO_RESULT'; end if;
  select value -> v_m.game into v_g from config where key = 'games';
  v_nobet := coalesce((v_g ->> 'nobet')::boolean, false);

  if v_nobet then
    return query
      select s.slot, s.card_id, 0,
             case when v_m.win = 'W' then (v_g ->> 'win')::int else (v_g ->> 'lose')::int end
        from match_slots s where s.match_id = p_match_id and s.stage = 'ready';
    return;
  end if;

  if v_m.vs = 'staff' then
    v_mult := (v_g ->> 'mult')::numeric;
    return query
      select s.slot, s.card_id, s.bet,
             case when v_m.win = 'W' then floor(s.bet * v_mult)::int - s.bet
                  when v_g ->> 'loss' = 'half' then -floor(s.bet / 2.0)::int
                  else -s.bet end
        from match_slots s where s.match_id = p_match_id and s.stage = 'ready';
  else
    if not exists (select 1 from match_slots s
                    where s.match_id = p_match_id and s.stage = 'ready' and s.slot = v_m.win::int) then
      raise exception 'WINNER_GONE';
    end if;
    select coalesce(sum(s.bet), 0) into v_others from match_slots s
     where s.match_id = p_match_id and s.stage = 'ready' and s.slot <> v_m.win::int;
    return query
      select s.slot, s.card_id, s.bet,
             case when s.slot = v_m.win::int then s.bet + v_others else -s.bet end
        from match_slots s where s.match_id = p_match_id and s.stage = 'ready';
  end if;
end $$;

-- 시작
create or replace function public.start_match(p_station text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_m public.matches%rowtype; v_g jsonb; v_n int; v_vs text;
begin
  select * into v_m from matches
   where station = p_station and phase in ('prep','playing','pick','review') for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if v_m.phase <> 'prep' then return jsonb_build_object('vs', v_m.vs); end if;  -- 이미 시작됨
  if exists (select 1 from match_slots where match_id = v_m.id and stage <> 'ready') then
    raise exception 'PENDING_SLOTS';
  end if;
  select count(*) into v_n from match_slots where match_id = v_m.id;
  if v_n = 0 then raise exception 'NO_PLAYERS'; end if;

  select value -> v_m.game into v_g from config where key = 'games';
  v_vs := case when v_n = 1 or (v_g ->> 'slots')::int = 1
                 or coalesce((v_g ->> 'nobet')::boolean, false)
               then 'staff' else 'friends' end;

  update matches set phase = 'playing', vs = v_vs where id = v_m.id;
  insert into tlist (card_id, content, coin_delta, kind, match_id)
  select s.card_id, 'JOIN ' || v_m.game, 0, 'JOIN', v_m.id
    from match_slots s where s.match_id = v_m.id;
  return jsonb_build_object('vs', v_vs);
end $$;

-- 종료 (결과 선택 단계로)
create or replace function public.end_match(p_station text) returns void
language plpgsql set search_path = public as $$
declare v_m public.matches%rowtype;
begin
  select * into v_m from matches
   where station = p_station and phase in ('prep','playing','pick','review') for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if v_m.phase in ('pick','review') then return; end if;
  if v_m.phase <> 'playing' then raise exception 'BAD_PHASE'; end if;
  update matches set phase = 'pick', win = null where id = v_m.id;
end $$;

-- 결과 선택 + 증감 계산 (참여자에게 보여줄 값)
create or replace function public.set_result(p_station text, p_win text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_m public.matches%rowtype; v_g jsonb; v_nobet boolean; v_res jsonb;
begin
  select * into v_m from matches
   where station = p_station and phase in ('prep','playing','pick','review') for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if v_m.phase not in ('pick','review') then raise exception 'BAD_PHASE'; end if;
  select value -> v_m.game into v_g from config where key = 'games';
  v_nobet := coalesce((v_g ->> 'nobet')::boolean, false);

  if v_nobet or v_m.vs = 'staff' then
    if p_win not in ('W','L') then raise exception 'BAD_RESULT'; end if;
  else
    if p_win !~ '^[0-3]$' then raise exception 'BAD_RESULT'; end if;
    if not exists (select 1 from match_slots s
                    where s.match_id = v_m.id and s.stage = 'ready' and s.slot = p_win::int) then
      raise exception 'BAD_RESULT';
    end if;
  end if;

  update matches set win = p_win, phase = 'review' where id = v_m.id;
  update match_slots s set proposed_delta = d.r_delta, acked_at = null
    from calc_deltas(v_m.id) d
   where s.match_id = v_m.id and s.slot = d.r_slot;

  select jsonb_agg(jsonb_build_object('slot', slot, 'card', card_id, 'delta', proposed_delta) order by slot)
    into v_res from match_slots where match_id = v_m.id and stage = 'ready';
  return v_res;
end $$;

-- 결과 선택으로 되돌리기
create or replace function public.back_to_pick(p_station text) returns void
language plpgsql set search_path = public as $$
declare v_m public.matches%rowtype;
begin
  select * into v_m from matches
   where station = p_station and phase in ('prep','playing','pick','review') for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if v_m.phase = 'pick' then return; end if;
  if v_m.phase <> 'review' then raise exception 'BAD_PHASE'; end if;
  update matches set phase = 'pick', win = null where id = v_m.id;
  update match_slots set proposed_delta = null, acked_at = null where match_id = v_m.id;
end $$;

-- 참여자 "확인" (정산을 막지 않음)
create or replace function public.ack_result(p_card_id int) returns void
language plpgsql set search_path = public as $$
begin
  update match_slots s set acked_at = now()
    from matches m
   where s.match_id = m.id and s.card_id = p_card_id
     and m.phase = 'review' and s.acked_at is null;
end $$;

-- 정산 (코인이 실제로 움직이는 유일한 곳)
create or replace function public.settle_match(p_match_id bigint) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_m public.matches%rowtype; v_g jsonb; v_nobet boolean; v_won boolean; v_res jsonb; r record;
begin
  select * into v_m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if v_m.phase = 'settled' then return jsonb_build_object('already', true); end if;  -- 중복 정산 방지
  if v_m.phase <> 'review' then raise exception 'BAD_PHASE'; end if;

  select value -> v_m.game into v_g from config where key = 'games';
  v_nobet := coalesce((v_g ->> 'nobet')::boolean, false);

  perform 1 from cards
   where id in (select card_id from match_slots where match_id = p_match_id and stage = 'ready')
   order by id for update;

  for r in select * from calc_deltas(p_match_id) order by r_slot loop
    if balance_of(r.r_card) + r.r_delta < 0 then raise exception 'BALANCE_CHANGED'; end if;
    v_won := case when v_m.vs = 'friends' and not v_nobet then r.r_slot = v_m.win::int
                  else v_m.win = 'W' end;
    insert into tlist (card_id, content, coin_delta, kind, match_id)
    values (r.r_card,
            case when v_won then 'WIN ' else 'LOSE ' end || v_m.game || ' vs=' || v_m.vs
              || case when v_nobet then '' else ' bet=' || r.r_bet end,
            r.r_delta, 'RESULT', p_match_id);
    insert into glist (card_id, game, n, match_id)
    values (r.r_card, v_m.game, 1, p_match_id)
    on conflict (card_id, game) do update
      set n = glist.n + 1, updated_at = now(), match_id = excluded.match_id;
    update match_slots set proposed_delta = r.r_delta
     where match_id = p_match_id and slot = r.r_slot;
    update cards set active_match_id = null where id = r.r_card;
  end loop;

  update matches set phase = 'settled', settled_at = now(), ended_at = now() where id = p_match_id;

  for r in select card_id from match_slots where match_id = p_match_id and stage = 'ready' loop
    perform exit_if_part_ended(r.card_id);   -- 회차가 이미 종료됐다면 지금 퇴장
  end loop;

  select jsonb_agg(jsonb_build_object('slot', slot, 'card', card_id, 'delta', proposed_delta) order by slot)
    into v_res from match_slots where match_id = p_match_id and stage = 'ready';
  return v_res;
end $$;

-- 정지: 코인 변동 없이 매치 종료
create or replace function public.abort_match(p_station text) returns void
language plpgsql set search_path = public as $$
declare v_m public.matches%rowtype;
begin
  select * into v_m from matches
   where station = p_station and phase in ('prep','playing','pick','review') for update;
  if not found then return; end if;
  update cards set active_match_id = null
   where id in (select card_id from match_slots where match_id = v_m.id);
  update matches set phase = 'aborted', ended_at = now() where id = v_m.id;
end $$;

-- 서버(service_role)만 실행 가능
revoke execute on function public.calc_deltas(bigint)      from public, anon, authenticated;
revoke execute on function public.start_match(text)        from public, anon, authenticated;
revoke execute on function public.end_match(text)          from public, anon, authenticated;
revoke execute on function public.set_result(text,text)    from public, anon, authenticated;
revoke execute on function public.back_to_pick(text)       from public, anon, authenticated;
revoke execute on function public.ack_result(int)          from public, anon, authenticated;
revoke execute on function public.settle_match(bigint)     from public, anon, authenticated;
revoke execute on function public.abort_match(text)        from public, anon, authenticated;
grant  execute on function public.calc_deltas(bigint)      to service_role;
grant  execute on function public.start_match(text)        to service_role;
grant  execute on function public.end_match(text)          to service_role;
grant  execute on function public.set_result(text,text)    to service_role;
grant  execute on function public.back_to_pick(text)       to service_role;
grant  execute on function public.ack_result(int)          to service_role;
grant  execute on function public.settle_match(bigint)     to service_role;
grant  execute on function public.abort_match(text)        to service_role;