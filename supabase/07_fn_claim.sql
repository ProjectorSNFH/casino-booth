create or replace function public.claim_number(
  p_card_id       int,
  p_session_name  text
) returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_card   public.cards%rowtype;
  v_cur    int;
  v_id     bigint;
  v_con    text;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_ISSUED'; end if;
  if v_card.status <> 'pending' then raise exception 'IN_USE'; end if;

  -- 발급 데스크가 지금 대기 중인 번호가 아니면 입력을 받지 않음
  select current_card_id into v_cur from stations where code = 'suc1';
  if v_cur is distinct from p_card_id then raise exception 'NOT_ISSUED'; end if;

  -- 지난 요청은 만료 처리
  update claims set closed_at = now(), result = 'expired'
   where card_id = p_card_id and closed_at is null and expires_at < now();

  if exists (select 1 from claims where card_id = p_card_id and closed_at is null) then
    raise exception 'CLAIM_CONFLICT';
  end if;

  begin
    insert into claims (card_id, kind, session_name)
    values (p_card_id, 'issue', p_session_name)
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'claims_open_session_name' then raise exception 'SESSION_NAME_TAKEN';
    else raise exception 'CLAIM_CONFLICT'; end if;
  end;

  return v_id;
end $$;

revoke execute on function public.claim_number(int, text) from public, anon, authenticated;
grant  execute on function public.claim_number(int, text) to service_role;