-- Cupons Shopee capturados pela extensão (API interna da Shopee, via sessão do usuário).
-- Só exibição; o resgate, se existir, é feito localmente pela extensão.
create table if not exists public.shopee_coupons (
  promotion_id text primary key,
  voucher_code text not null,
  signature text,
  signature_source integer,
  bold_text text,
  light_text text,
  icon_text text,
  labels text[] default '{}',
  redirect_url text,
  collection_id text,
  end_time bigint,
  reward_type integer,
  percentage integer,
  min_spend bigint,
  value bigint,
  cap bigint,
  percentage_used integer,
  captured_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active boolean not null default true
);
create index if not exists shopee_coupons_active on public.shopee_coupons (active, last_seen_at desc);
