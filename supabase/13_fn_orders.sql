-- 주문당 구매 기록은 하나만
create unique index if not exists tlist_one_purchase
  on public.tlist (order_id) where kind = 'PURCHASE';

-- exit_card: 퇴장 이유에 'purchase' 추가
create or replace function public.exit_card(p_card_id int, p_reason text default 'staff') returns void
language plpgsql set search_path = public as $$
declare v_card public.cards%rowtype;
begin
  if p_reason not in ('staff','part_end','purchase') then raise exception 'BAD_REASON'; end if;
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_card.status in ('done','banned') then return; end if;
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

-- 주문 생성 (가격은 DB가 계산)
create or replace function public.create_order(p_card_id int, p_items jsonb) returns bigint
language plpgsql set search_path = public as $$
declare
  v_card public.cards%rowtype; v_limits jsonb; v_plays int;
  v_total int := 0; v_snap jsonb := '[]'::jsonb; v_id bigint; v_old bigint;
  r record; pr public.products%rowtype;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select id into v_old from orders where card_id = p_card_id and status = 'pending';
  if found then return v_old; end if;                     -- 같은 요청 재전송: 기존 주문 반환

  if v_card.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;
  if card_busy(p_card_id) = 'IN_MATCH' then raise exception 'IN_MATCH'; end if;

  select value into v_limits from config where key = 'limits';
  select coalesce(sum(n), 0) into v_plays from glist
   where card_id = p_card_id and game <> 'SLOTMACHINE';
  if v_plays < (v_limits ->> 'shop_min_plays')::int then raise exception 'NOT_ENOUGH_PLAYS'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'BAD_ITEMS';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
              where (e ->> 'id') !~ '^[0-9]{1,4}$'
                 or case when (e ->> 'qty') ~ '^[0-9]{1,2}$' then (e ->> 'qty')::int else 0 end < 1) then
    raise exception 'BAD_ITEMS';
  end if;

  for r in select (e ->> 'id')::int as pid, sum((e ->> 'qty')::int)::int as q
             from jsonb_array_elements(p_items) e group by 1 order by 1 loop
    select * into pr from products where id = r.pid;
    if not found then raise exception 'BAD_ITEMS'; end if;
    if pr.status = 'sold_out' then raise exception 'SOLD_OUT' using detail = pr.name; end if;
    v_total := v_total + pr.price * r.q;
    v_snap := v_snap || jsonb_build_array(
      jsonb_build_object('id', pr.id, 'name', pr.name, 'qty', r.q, 'price', pr.price));
  end loop;

  if v_total > balance_of(p_card_id) then raise exception 'OVER_BALANCE'; end if;

  insert into orders (card_id, items, total) values (p_card_id, v_snap, v_total)
  returning id into v_id;
  return v_id;
end $$;

-- 참여자: 승인 전 취소 (이미 없으면 그냥 통과)
create or replace function public.cancel_order(p_card_id int) returns void
language plpgsql set search_path = public as $$
begin
  update orders set status = 'cancelled' where card_id = p_card_id and status = 'pending';
end $$;

-- 승인
create or replace function public.approve_order(p_order_id bigint) returns jsonb
language plpgsql set search_path = public as $$
declare o public.orders%rowtype; v_card public.cards%rowtype; v_bad text; v_bal int;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'NO_ORDER'; end if;
  if o.status in ('approved','delivered') then
    return jsonb_build_object('already', true, 'order_id', o.id);   -- 중복 승인 방지
  end if;
  if o.status <> 'pending' then raise exception 'ORDER_CLOSED'; end if;

  select * into v_card from cards where id = o.card_id for update;
  if v_card.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;

  select string_agg(x.name, ', ') into v_bad
    from jsonb_to_recordset(o.items) as x(id int, name text, qty int, price int)
    join products pr on pr.id = x.id
   where pr.status = 'sold_out';
  if v_bad is not null then raise exception 'SOLD_OUT' using detail = v_bad; end if;

  v_bal := balance_of(o.card_id);
  if v_bal < o.total then raise exception 'BALANCE_LOW'; end if;

  insert into tlist (card_id, content, coin_delta, kind, order_id)
  values (o.card_id, 'PURCHASE order=' || o.id, -o.total, 'PURCHASE', o.id);
  update orders set status = 'approved', approved_at = now() where id = o.id;
  perform exit_card(o.card_id, 'purchase');

  return jsonb_build_object('order_id', o.id, 'total', o.total, 'balance', v_bal - o.total);
end $$;

-- 거절
create or replace function public.reject_order(p_order_id bigint) returns void
language plpgsql set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'NO_ORDER'; end if;
  if o.status = 'rejected' then return; end if;
  if o.status <> 'pending' then raise exception 'ORDER_CLOSED'; end if;
  update orders set status = 'rejected' where id = p_order_id;
end $$;

-- 배부 완료
create or replace function public.deliver_order(p_order_id bigint) returns void
language plpgsql set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'NO_ORDER'; end if;
  if o.status = 'delivered' then return; end if;
  if o.status <> 'approved' then raise exception 'NOT_APPROVED'; end if;
  update orders set status = 'delivered', delivered_at = now() where id = p_order_id;
end $$;

-- 서버(service_role)만 실행 가능
revoke execute on function public.create_order(int,jsonb)   from public, anon, authenticated;
revoke execute on function public.cancel_order(int)         from public, anon, authenticated;
revoke execute on function public.approve_order(bigint)     from public, anon, authenticated;
revoke execute on function public.reject_order(bigint)      from public, anon, authenticated;
revoke execute on function public.deliver_order(bigint)     from public, anon, authenticated;
grant  execute on function public.create_order(int,jsonb)   to service_role;
grant  execute on function public.cancel_order(int)         to service_role;
grant  execute on function public.approve_order(bigint)     to service_role;
grant  execute on function public.reject_order(bigint)      to service_role;
grant  execute on function public.deliver_order(bigint)     to service_role;