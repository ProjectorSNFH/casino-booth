-- 매치 중이거나 주문 대기 중인지 확인 (아니면 null)
create or replace function public.card_busy(p_card_id int) returns text
language sql stable set search_path = public as $$
  select case
    when exists (select 1 from match_slots s join matches m on m.id = s.match_id
                  where s.card_id = p_card_id
                    and m.phase in ('prep','playing','pick','review')) then 'IN_MATCH'
    when exists (select 1 from orders
                  where card_id = p_card_id and status = 'pending') then 'PENDING_ORDER'
    else null end
$$;

-- 퇴장
create or replace function public.exit_card(p_card_id int, p_reason text default 'staff') returns void
language plpgsql set search_path = public as $$
declare v_card public.cards%rowtype;
begin
  if p_reason not in ('staff','part_end') then raise exception 'BAD_REASON'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_card.status in ('done','banned') then return; end if;   -- 이미 처리됨
  if v_card.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;
  if exists (select 1 from match_slots s join matches m on m.id = s.match_id
              where s.card_id = p_card_id
                and m.phase in ('prep','playing','pick','review')) then
    raise exception 'IN_MATCH';
  end if;

  update orders set status = 'cancelled' where card_id = p_card_id and status = 'pending';
  update claims set closed_at = now(), result = 'cancelled'
   where card_id = p_card_id and closed_at is null;
  update cards set status = 'done', active_match_id = null where id = p_card_id;
  insert into tlist (card_id, content, coin_delta, kind)
  values (p_card_id, 'EXIT reason=' || p_reason, 0, 'EXIT');
end $$;

-- 이용 제한 (매치 중에도 가능)
create or replace function public.ban_card(p_card_id int) returns void
language plpgsql set search_path = public as $$
declare v_card public.cards%rowtype;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_card.status = 'banned' then return; end if;
  if v_card.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;

  delete from match_slots s using matches m
   where s.match_id = m.id and s.card_id = p_card_id
     and m.phase in ('prep','playing','pick','review');
  update orders set status = 'cancelled' where card_id = p_card_id and status = 'pending';
  update claims set closed_at = now(), result = 'cancelled'
   where card_id = p_card_id and closed_at is null;
  update cards set status = 'banned', active_match_id = null where id = p_card_id;
  insert into tlist (card_id, content, coin_delta, kind)
  values (p_card_id, 'BAN reason=staff', 0, 'BAN');
end $$;

-- 정산/주문이 끝난 직후 호출: 회차가 이미 종료됐으면 퇴장
create or replace function public.exit_if_part_ended(p_card_id int) returns boolean
language plpgsql set search_path = public as $$
declare v_card public.cards%rowtype; v_parts jsonb;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found or v_card.status <> 'active' then return false; end if;
  select value into v_parts from config where key = 'parts';
  if coalesce(v_parts ->> v_card.part::text, 'ended') <> 'ended' then return false; end if;
  if card_busy(p_card_id) is not null then return false; end if;
  perform exit_card(p_card_id, 'part_end');
  return true;
end $$;

-- 회차 시작/종료 (종료 시 활성 카드 자동 퇴장)
create or replace function public.set_part(p_part smallint, p_status text) returns jsonb
language plpgsql set search_path = public as $$
declare r record; v_ex int := 0; v_def int := 0;
begin
  if p_part not in (1, 2) then raise exception 'BAD_PART'; end if;
  if p_status not in ('active','ended') then raise exception 'BAD_STATUS'; end if;

  perform 1 from config where key = 'parts' for update;
  update config set value = jsonb_set(value, array[p_part::text], to_jsonb(p_status))
   where key = 'parts';

  if p_status = 'ended' then
    for r in select id from cards where part = p_part and status = 'active' order by id loop
      if card_busy(r.id) is null then
        perform exit_card(r.id, 'part_end'); v_ex := v_ex + 1;
      else
        v_def := v_def + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('exited', v_ex, 'deferred', v_def);
end $$;

-- 서버(service_role)만 실행 가능
revoke execute on function public.card_busy(int)               from public, anon, authenticated;
revoke execute on function public.exit_card(int,text)          from public, anon, authenticated;
revoke execute on function public.ban_card(int)                from public, anon, authenticated;
revoke execute on function public.exit_if_part_ended(int)      from public, anon, authenticated;
revoke execute on function public.set_part(smallint,text)      from public, anon, authenticated;
grant  execute on function public.card_busy(int)               to service_role;
grant  execute on function public.exit_card(int,text)          to service_role;
grant  execute on function public.ban_card(int)                to service_role;
grant  execute on function public.exit_if_part_ended(int)      to service_role;
grant  execute on function public.set_part(smallint,text)      to service_role;