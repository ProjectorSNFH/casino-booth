-- 1) 새 기기가 첫 토큰을 받을 때 쓰는 비밀의 해시
alter table public.claims add column if not exists secret_hash text;

-- 2) claim_number 교체 (비밀 해시를 함께 저장)
drop function if exists public.claim_number(int, text);

create or replace function public.claim_number(
  p_card_id int, p_session_name text, p_secret_hash text
) returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
  v_cur  int;
  v_id   bigint;
  v_con  text;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_ISSUED'; end if;
  if v_card.status <> 'pending' then raise exception 'IN_USE'; end if;

  select current_card_id into v_cur from stations where code = 'suc1';
  if v_cur is distinct from p_card_id then raise exception 'NOT_ISSUED'; end if;

  update claims set closed_at = now(), result = 'expired'
   where card_id = p_card_id and closed_at is null and expires_at < now();

  if exists (select 1 from claims where card_id = p_card_id and closed_at is null) then
    raise exception 'CLAIM_CONFLICT';
  end if;

  begin
    insert into claims (card_id, kind, session_name, secret_hash)
    values (p_card_id, 'issue', p_session_name, p_secret_hash)
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'claims_open_session_name' then raise exception 'SESSION_NAME_TAKEN';
    else raise exception 'CLAIM_CONFLICT'; end if;
  end;

  return v_id;
end $$;

-- 3) 재연결 요청
create or replace function public.request_reconnect(
  p_card_id int, p_session_name text, p_secret_hash text
) returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
  v_id   bigint;
  v_con  text;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_card.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;

  -- 같은 카드의 이전 재연결 요청은 새 요청으로 대체
  update claims
     set closed_at = now(),
         result = case when expires_at < now() then 'expired' else 'cancelled' end
   where card_id = p_card_id and kind = 'reconnect' and closed_at is null;

  if exists (select 1 from claims where card_id = p_card_id and closed_at is null) then
    raise exception 'CLAIM_CONFLICT';
  end if;

  begin
    insert into claims (card_id, kind, session_name, secret_hash)
    values (p_card_id, 'reconnect', p_session_name, p_secret_hash)
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'claims_open_session_name' then raise exception 'SESSION_NAME_TAKEN';
    else raise exception 'CLAIM_CONFLICT'; end if;
  end;

  return v_id;
end $$;

-- 4) 재연결 확정: 이전 기기 로그인 무효화(token_version +1)
create or replace function public.confirm_reconnect(p_claim_id bigint) returns int
language plpgsql
set search_path = public
as $$
declare
  v_claim public.claims%rowtype;
  v_card  public.cards%rowtype;
  v_ver   int;
begin
  select * into v_claim from claims where id = p_claim_id for update;
  if not found or v_claim.kind <> 'reconnect' then raise exception 'NO_CLAIM'; end if;

  select * into v_card from cards where id = v_claim.card_id for update;

  if v_claim.closed_at is not null then
    if v_claim.result = 'confirmed' then return v_card.token_version; end if;  -- 이미 확정: 같은 결과
    raise exception 'CLAIM_CLOSED';
  end if;
  if v_claim.expires_at < now() then raise exception 'CLAIM_EXPIRED'; end if;
  if v_card.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;

  update cards set token_version = token_version + 1
   where id = v_card.id returning token_version into v_ver;
  insert into tlist (card_id, content, coin_delta, kind)
  values (v_card.id, 'RECONNECT', 0, 'RECONNECT');
  update claims set closed_at = now(), result = 'confirmed' where id = p_claim_id;

  return v_ver;
end $$;

-- 5) 재연결 거절
create or replace function public.reject_reconnect(p_claim_id bigint) returns void
language plpgsql
set search_path = public
as $$
begin
  update claims set closed_at = now(), result = 'rejected'
   where id = p_claim_id and kind = 'reconnect' and closed_at is null;
end $$;

-- 6) 서버(service_role)만 실행 가능
revoke execute on function public.claim_number(int,text,text)       from public, anon, authenticated;
revoke execute on function public.request_reconnect(int,text,text)  from public, anon, authenticated;
revoke execute on function public.confirm_reconnect(bigint)         from public, anon, authenticated;
revoke execute on function public.reject_reconnect(bigint)          from public, anon, authenticated;
grant  execute on function public.claim_number(int,text,text)       to service_role;
grant  execute on function public.request_reconnect(int,text,text)  to service_role;
grant  execute on function public.confirm_reconnect(bigint)         to service_role;
grant  execute on function public.reject_reconnect(bigint)          to service_role;