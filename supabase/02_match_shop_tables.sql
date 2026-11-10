-- ===== 1) 스테이션 =====
create table public.stations (
  code            text primary key,
  role            text not null check (role in
                  ('issue','adjust','game','shop_approve','shop_deliver','hof')),
  game            text,
  current_card_id int references public.cards(id),
  last_seen_at    timestamptz
);

-- ===== 2) 매치 =====
create table public.matches (
  id          bigint generated always as identity primary key,
  station     text not null references public.stations(code),
  game        text not null check (game in
              ('HALLIGALLI','SKEWER','CHAMCHAMCHAM','JOKER','RANDOMBALL','TABLESOCCER')),
  vs          text check (vs in ('staff','friends')),
  phase       text not null default 'prep'
              check (phase in ('prep','playing','pick','review','settled','aborted')),
  win         text,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz,
  ended_at    timestamptz
);
-- 스테이션 하나에는 진행 중인 매치가 하나만
create unique index one_open_match_per_station
  on public.matches (station) where phase in ('prep','playing','pick','review');

-- ===== 3) 매치 슬롯 =====
create table public.match_slots (
  match_id        bigint not null references public.matches(id),
  slot            smallint not null check (slot between 0 and 3),
  card_id         int not null references public.cards(id),
  stage           text not null default 'scanned'
                  check (stage in ('scanned','bet_set','ready')),
  bet             int check (bet is null or bet >= 0),
  proposed_delta  int,
  acked_at        timestamptz,
  primary key (match_id, slot),
  unique (match_id, card_id)
);

-- ===== 4) 발급/재연결 대기(세션명 대조) =====
create table public.claims (
  id            bigint generated always as identity primary key,
  card_id       int not null references public.cards(id),
  kind          text not null check (kind in ('issue','reconnect')),
  session_name  text not null check (session_name ~ '^[a-z]{5}$'),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '10 minutes',
  closed_at     timestamptz,
  result        text check (result in ('confirmed','cancelled','rejected','expired'))
);
create unique index claims_one_open_per_card
  on public.claims (card_id) where closed_at is null;
create unique index claims_open_session_name
  on public.claims (session_name) where closed_at is null;

-- ===== 5) 상품과 주문 =====
create table public.products (
  id      smallint generated always as identity primary key,
  name    text not null unique,
  price   int not null check (price > 0),
  status  text not null default 'on_sale' check (status in ('on_sale','sold_out')),
  sort    smallint not null default 0
);

create table public.orders (
  id            bigint generated always as identity primary key,
  card_id       int not null references public.cards(id),
  items         jsonb not null,
  total         int not null check (total > 0),
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','cancelled','delivered')),
  created_at    timestamptz not null default now(),
  approved_at   timestamptz,
  delivered_at  timestamptz
);
create unique index orders_one_pending_per_card
  on public.orders (card_id) where status = 'pending';
create index orders_queue_idx on public.orders (status, created_at);

-- ===== 6) 설정값 =====
create table public.config (
  key    text primary key,
  value  jsonb not null
);

-- ===== 7) 앞서 만든 표와 연결 =====
alter table public.cards
  add constraint cards_active_match_fk
  foreign key (active_match_id) references public.matches(id);
alter table public.tlist
  add constraint tlist_match_fk foreign key (match_id) references public.matches(id),
  add constraint tlist_order_fk foreign key (order_id) references public.orders(id);
alter table public.glist
  add column match_id bigint references public.matches(id);

-- ===== 8) 보안: RLS 켜기 =====
alter table public.stations    enable row level security;
alter table public.matches     enable row level security;
alter table public.match_slots enable row level security;
alter table public.claims      enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.config      enable row level security;