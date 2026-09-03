begin;

create table public.mercado_livre_products (
  id uuid primary key default gen_random_uuid(),
  ml_item_id text not null unique,
  product_name text not null,
  image_url text,
  price numeric(14,2),
  original_price numeric(14,2),
  commission_rate numeric(8,4),
  commission_value numeric(14,2),
  product_link text,
  category text,
  ml_category text,
  source_fetched_at timestamptz,
  sales integer,
  rating_star numeric(3,2),
  discount_rate numeric(6,2),
  is_hot boolean not null default false,
  is_full boolean not null default false,
  free_shipping boolean not null default false,
  seller_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now()
);

create index mercado_livre_products_catalog_idx
  on public.mercado_livre_products (active, category, price, commission_rate, updated_at desc);
create index mercado_livre_products_name_search_idx
  on public.mercado_livre_products using gin (to_tsvector('portuguese', product_name));

create table public.mercado_livre_catalog_sync_logs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total_received integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  duration_ms integer,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'blocked')),
  error_message text,
  created_at timestamptz not null default now()
);

create index mercado_livre_catalog_sync_logs_recent_idx
  on public.mercado_livre_catalog_sync_logs (started_at desc);

alter table public.mercado_livre_products enable row level security;
alter table public.mercado_livre_catalog_sync_logs enable row level security;
-- Catálogo e importação são acessados exclusivamente pelo backend com service role.

notify pgrst, 'reload schema';
commit;
