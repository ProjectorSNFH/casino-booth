-- 1) 브라우저 기본 권한 회수
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant  execute on functions to service_role;

-- 2) 토큰 안의 값 읽는 도우미
create or replace function public.jwt_kind() returns text
language sql stable as $$ select auth.jwt() ->> 'kind' $$;
create or replace function public.jwt_card_id() returns int
language sql stable as $$ select nullif(auth.jwt() ->> 'card_id', '')::int $$;
create or replace function public.jwt_claim_id() returns bigint
language sql stable as $$ select nullif(auth.jwt() ->> 'claim_id', '')::bigint $$;
create or replace function public.jwt_station() returns text
language sql stable as $$ select auth.jwt() ->> 'station' $$;
create or replace function public.jwt_role() returns text
language sql stable security definer set search_path = public as $$
  select s.role from stations s
   where s.code = auth.jwt() ->> 'station' and auth.jwt() ->> 'kind' = 'staff'
$$;
create or replace function public.match_station(p_match_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select station from matches where id = p_match_id
$$;
grant execute on function public.jwt_kind(), public.jwt_card_id(), public.jwt_claim_id(),
  public.jwt_station(), public.jwt_role(), public.match_station(bigint) to anon, authenticated;

-- 3) 읽기 규칙 (RLS)
create policy p_card_state_self on public.card_state for select to authenticated
  using (jwt_kind() = 'participant' and card_id = jwt_card_id());
create policy p_card_state_issue on public.card_state for select to authenticated
  using (jwt_role() = 'issue');
create policy p_matches_station on public.matches for select to authenticated
  using (jwt_role() = 'game' and station = jwt_station());
create policy p_slots_station on public.match_slots for select to authenticated
  using (jwt_role() = 'game' and match_station(match_id) = jwt_station());
create policy p_claims_self on public.claims for select to authenticated
  using (jwt_kind() = 'claimant' and id = jwt_claim_id());
create policy p_claims_issue on public.claims for select to authenticated
  using (jwt_role() = 'issue');
create policy p_orders_self on public.orders for select to authenticated
  using (jwt_kind() = 'participant' and card_id = jwt_card_id());
create policy p_orders_staff on public.orders for select to authenticated
  using (jwt_role() in ('shop_approve', 'shop_deliver'));
create policy p_products_all on public.products for select to anon, authenticated
  using (true);

-- 4) 읽기 권한만 부여
grant select on public.card_state, public.matches, public.match_slots,
                public.claims, public.orders to authenticated;
grant select on public.products to anon, authenticated;

-- 5) 실시간 켜기
alter publication supabase_realtime add table
  public.card_state, public.matches, public.match_slots,
  public.claims, public.orders, public.products;