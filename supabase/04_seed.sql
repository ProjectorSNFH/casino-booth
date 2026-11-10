-- ===== 1) 스테이션 =====
insert into public.stations (code, role, game) values
  ('suc1', 'issue',        null),
  ('suc2', 'adjust',       null),
  ('hg21', 'game',         'HALLIGALLI'),
  ('stm1', 'game',         'SKEWER'),
  ('ayh1', 'game',         'CHAMCHAMCHAM'),
  ('jks1', 'game',         'JOKER'),
  ('rdb1', 'game',         'RANDOMBALL'),
  ('rtc1', 'game',         'TABLESOCCER'),
  ('shp1', 'shop_approve', null),
  ('shp2', 'shop_deliver', null),
  ('tbs1', 'hof',          null)
on conflict (code) do nothing;

-- ===== 2) 상품 =====
insert into public.products (name, price, sort) values
  ('마이쥬',       3, 1),
  ('마카로니',     7, 2),
  ('초코파이',     9, 3),
  ('쌀과자',       5, 4),
  ('젤리스트로우', 7, 5)
on conflict (name) do nothing;

-- ===== 3) 설정값 =====
insert into public.config (key, value) values
  ('games', '{
    "HALLIGALLI":   {"name":"할리갈리",    "mult":2,   "loss":"all",  "max_plays":3, "slots":3},
    "SKEWER":       {"name":"꼬치의 달인", "mult":2,   "loss":"all",  "max_plays":3, "slots":4},
    "CHAMCHAMCHAM": {"name":"참참참",      "mult":1.5, "loss":"half", "max_plays":4, "slots":1},
    "JOKER":        {"name":"조커 뽑기",   "mult":5,   "loss":"all",  "max_plays":2, "slots":1},
    "RANDOMBALL":   {"name":"랜덤 공",     "nobet":true, "win":2, "lose":-2, "min_coins":2, "max_plays":5, "slots":1},
    "TABLESOCCER":  {"name":"테이블 축구", "mult":2.5, "loss":"all",  "max_plays":1, "slots":4}
  }'::jsonb),
  ('limits', '{
    "part_cap": {"1":500, "2":499},
    "active_cap": 15,
    "welcome_coins": 5,
    "shop_min_plays": 2
  }'::jsonb),
  ('parts', '{"1":"ended", "2":"ended"}'::jsonb)
on conflict (key) do nothing;