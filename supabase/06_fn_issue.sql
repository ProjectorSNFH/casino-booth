-- 식별번호 번호표 (1부는 1부터, 2부는 501부터)
insert into public.config (key, value) values ('next_ids', '{"1":1,"2":501}'::jsonb)
on conflict (key) do nothing;

create or replace function public.issue_card(
  p_part      smallint,
  p_sid_hmac  text,
  p_name_enc  text,
  p_sid_enc   text,
  p_mask      text,
  p_uid       text
) returns int
language plpgsql
set search_path = public
as $$
declare
  v_station  public.stations%rowtype;
  v_parts    jsonb;
  v_limits   jsonb;
  v_next     jsonb;
  v_id       int;
  v_active   int;
  v_issued   int;
begin
  -- 발급 슬롯 잠금: 동시에 들어온 발급 요청을 한 명씩 처리
  select * into v_station from stations where code = 'suc1' for update;
  if not found then raise exception 'STATION_MISSING'; end if;
  if v_station.current_card_id is not null then raise exception 'ISSUE_BUSY'; end if;

  select value into v_parts  from config where key = 'parts';
  select value into v_limits from config where key = 'limits';
  select value into v_next   from config where key = 'next_ids' for update;

  if coalesce(v_parts ->> p_part::text, 'ended') <> 'active' then
    raise exception 'PART_ENDED';
  end if;

  select count(*) into v_active from cards where status = 'active';
  if v_active >= (v_limits ->> 'active_cap')::int then raise exception 'ACTIVE_FULL'; end if;

  select count(*) into v_issued from cards where part = p_part;
  if v_issued >= (v_limits -> 'part_cap' ->> p_part::text)::int then raise exception 'PART_FULL'; end if;

  v_id := (v_next ->> p_part::text)::int;
  if (p_part = 1 and v_id > 500) or (p_part = 2 and v_id > 999) then raise exception 'PART_FULL'; end if;

  if exists (select 1 from cards where sid_hmac = p_sid_hmac) then raise exception 'DUPLICATE_SID'; end if;

  insert into cards (id, uid, name_enc, sid_enc, sid_hmac, mask_name, part, status)
  values (v_id, p_uid, p_name_enc, p_sid_enc, p_sid_hmac, p_mask, p_part, 'pending');

  update config set value = jsonb_set(v_next, array[p_part::text], to_jsonb(v_id + 1)) where key = 'next_ids';
  update stations set current_card_id = v_id, last_seen_at = now() where code = 'suc1';

  return v_id;
end $$;

-- 서버(service_role)만 실행 가능
revoke execute on function public.issue_card(smallint,text,text,text,text,text) from public, anon, authenticated;
grant  execute on function public.issue_card(smallint,text,text,text,text,text) to service_role;