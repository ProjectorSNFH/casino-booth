        -- ===== 1) 카드(참여자 명부) =====
create table public.cards (
  id              int primary key,
  uid             text not null unique,
  name_enc        text not null,
  sid_enc         text not null,
  sid_hmac        text not null unique,
  mask_name       text not null,
  part            smallint not null check (part in (1, 2)),
  status          text not null default 'pending'
                  check (status in ('pending', 'active', 'done', 'banned')),
  token_version   int not null default 1,
  active_match_id bigint,
  created_at      timestamptz not null default now(),
  activated_at    timestamptz,
  constraint cards_id_by_part check (
    (part = 1 and id between 1 and 500) or (part = 2 and id between 501 and 999)
  )
);

-- ===== 2) TList (코인 기록: 수정·삭제 가능) =====
create table public.tlist (
  id          bigint generated always as identity primary key,
  card_id     int not null references public.cards(id),
  at          timestamptz not null default now(),
  content     text not null,
  coin_delta  int not null,
  kind        text not null check (kind in
              ('WELCOME','JOIN','RESULT','EVENT','PURCHASE','EXIT','BAN','RECONNECT','ADJUST')),
  match_id    bigint,
  order_id    bigint
);
create index tlist_card_idx on public.tlist (card_id, at, id);
-- 같은 매치에서 같은 카드의 같은 종류 기록이 두 번 들어가는 사고를 막는 안전장치
create unique index tlist_once_per_match
  on public.tlist (match_id, card_id, kind) where match_id is not null;

-- ===== 3) GList (게임별 참여 횟수: 카드당 게임당 값 하나) =====
create table public.glist (
  card_id     int not null references public.cards(id),
  game        text not null check (game in
              ('HALLIGALLI','SKEWER','CHAMCHAMCHAM','JOKER','RANDOMBALL','TABLESOCCER')),
  n           int not null default 0 check (n >= 0),
  updated_at  timestamptz not null default now(),
  primary key (card_id, game)
);

-- ===== 4) 감사 기록: TList의 수정·삭제를 자동으로 보관 =====
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  table_name  text not null,
  op          text not null,
  old_row     jsonb,
  new_row     jsonb
);

create function public.audit_tlist() returns trigger
language plpgsql as $$
begin
  insert into public.audit_log (table_name, op, old_row, new_row)
  values (tg_table_name, tg_op, to_jsonb(old), case when tg_op = 'UPDATE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger tlist_audit after update or delete on public.tlist
  for each row execute function public.audit_tlist();

-- ===== 5) 보안: RLS 켜기 (허용 규칙은 나중에 추가) =====
alter table public.cards     enable row level security;
alter table public.tlist     enable row level security;
alter table public.glist     enable row level security;
alter table public.audit_log enable row level security;