create or replace function public.slot_event(p_card_id int, p_reward int) returns jsonb
language plpgsql set search_path = public as $$
declare v_card public.cards%rowtype; v_cfg jsonb; v_old int;
begin
  select value -> 'SLOTMACHINE' into v_cfg from config where key = 'events';
  if p_reward is null or not coalesce((v_cfg -> 'rewards') @> to_jsonb(p_reward), false) then
    raise exception 'BAD_REWARD';
  end if;

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select coin_delta into v_old from tlist
   where card_id = p_card_id and kind = 'EVENT' and content like 'EVENT SLOTMACHINE %';
  if found then
    if v_old = p_reward then
      return jsonb_build_object('already', true, 'reward', v_old, 'balance', balance_of(p_card_id));
    end if;
    raise exception 'ALREADY_PLAYED';
  end if;

  if v_card.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;

  insert into tlist (card_id, content, coin_delta, kind)
  values (p_card_id, 'EVENT SLOTMACHINE ' || case when p_reward > 0 then 'GAIN' else 'MISS' end,
          p_reward, 'EVENT');
  insert into glist (card_id, game, n) values (p_card_id, 'SLOTMACHINE', 1)
  on conflict (card_id, game) do update set n = glist.n + 1, updated_at = now();

  return jsonb_build_object('reward', p_reward, 'balance', balance_of(p_card_id));
end $$;

revoke execute on function public.slot_event(int,int) from public, anon, authenticated;
grant  execute on function public.slot_event(int,int) to service_role;