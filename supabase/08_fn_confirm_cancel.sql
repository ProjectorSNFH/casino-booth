-- WELCOME 기록은 카드당 하나만
create unique index if not exists tlist_one_welcome
  on public.tlist (card_id) where kind = 'WELCOME';

create or replace function public.confirm_card(p_card_id int) returns int
language plpgsql
set search_path = public
as $$
declare
  v_station public.stations%rowtype;
  v_card    public.cards%rowtype;
  v_claim   public.claims%rowtype;
  v_parts   jsonb;
  v_limits  jsonb;
  v_active  int;
begin
  select * into v_station from stations where code = 'suc1' for update;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_ISSUED'; end if;

  if v_card.status = 'active' then return v_card.id; end if;   -- 이미 확정됨: 같은 결과
  if v_card.status <> 'pending' then raise exception 'IN_USE'; end if;
  if v_station.current_card_id is distinct from p_card_id then raise exception 'NOT_CURRENT'; end if;

  select * into v_claim from claims where card_id = p_card_id and closed_at is null;
  if not found then raise exception 'NO_CLAIM'; end if;
  if v_claim.expires_at < now() then raise exception 'CLAIM_EXPIRED'; end if;

  select value into v_parts  from config where key = 'parts';
  select value into v_limits from config where key = 'limits';
  if coalesce(v_parts ->> v_card.part::text, 'ended') <> 'active' then raise exception 'PART_ENDED'; end if;

  select count(*) into v_active from cards where status = 'active';
  if v_active >= (v_limits ->> 'active_cap')::int then raise exception 'ACTIVE_FULL'; end if;

  update cards set status = 'active', activated_at = now() where id = p_card_id;
  insert into tlist (card_id, content, coin_delta, kind)
  values (p_card_id, 'WELCOME', (v_limits ->> 'welcome_coins')::int, 'WELCOME');
  update claims set closed_at = now(), result = 'confirmed' where id = v_claim.id;
  update stations set current_card_id = null, last_seen_at = now() where code = 'suc1';

  return p_card_id;
end $$;

create or replace function public.cancel_issue(p_card_id int) returns void
language plpgsql
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
begin
  perform 1 from stations where code = 'suc1' for update;
  select * into v_card from cards where id = p_card_id for update;

  if not found then   -- 이미 취소된 요청이 다시 와도 안전
    update stations set current_card_id = null where code = 'suc1' and current_card_id = p_card_id;
    return;
  end if;
  if v_card.status <> 'pending' then raise exception 'IN_USE'; end if;

  update stations set current_card_id = null, last_seen_at = now()
   where code = 'suc1' and current_card_id = p_card_id;
  delete from claims where card_id = p_card_id;
  delete from cards  where id = p_card_id;
end $$;

revoke execute on function public.confirm_card(int) from public, anon, authenticated;
revoke execute on function public.cancel_issue(int) from public, anon, authenticated;
grant  execute on function public.confirm_card(int) to service_role;
grant  execute on function public.cancel_issue(int) to service_role;