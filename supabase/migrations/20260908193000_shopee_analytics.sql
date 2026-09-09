begin;

create table public.shopee_affiliate_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  integration_id uuid not null references public.affiliate_integrations(id) on delete cascade,
  order_id text not null,
  conversion_id text,
  checkout_id text,
  purchase_time timestamptz not null,
  conversion_status text not null,
  order_status text not null,
  estimated_commission numeric(18,6) not null default 0,
  total_commission numeric(18,6) not null default 0,
  net_commission numeric(18,6) not null default 0,
  synced_at timestamptz not null default now(),
  unique(account_id, integration_id, order_id)
);

create table public.shopee_affiliate_order_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  integration_id uuid not null references public.affiliate_integrations(id) on delete cascade,
  order_id text not null,
  item_key text not null,
  item_id text,
  model_id text,
  item_name text not null,
  shop_id text,
  shop_name text,
  item_price numeric(18,6) not null default 0,
  actual_amount numeric(18,6) not null default 0,
  refund_amount numeric(18,6) not null default 0,
  quantity integer not null default 0,
  commission numeric(18,6) not null default 0,
  seller_commission numeric(18,6) not null default 0,
  shopee_commission numeric(18,6) not null default 0,
  seller_commission_rate numeric(18,6),
  shopee_commission_rate numeric(18,6),
  item_status text,
  complete_time timestamptz,
  image_url text,
  synced_at timestamptz not null default now(),
  unique(account_id, integration_id, order_id, item_key)
);

create table public.shopee_affiliate_sync_state (
  account_id uuid not null references public.accounts(id) on delete cascade,
  integration_id uuid not null references public.affiliate_integrations(id) on delete cascade,
  coverage_start date,
  coverage_end date,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key(account_id, integration_id)
);

create index shopee_orders_period_idx on public.shopee_affiliate_orders(account_id, purchase_time desc);
create index shopee_orders_status_idx on public.shopee_affiliate_orders(account_id, conversion_status, order_status);
create index shopee_items_order_idx on public.shopee_affiliate_order_items(account_id, integration_id, order_id);
create index shopee_items_product_idx on public.shopee_affiliate_order_items(account_id, item_name);
create index shopee_items_shop_idx on public.shopee_affiliate_order_items(account_id, shop_name);

alter table public.shopee_affiliate_orders enable row level security;
alter table public.shopee_affiliate_order_items enable row level security;
alter table public.shopee_affiliate_sync_state enable row level security;
create policy tenant_isolation on public.shopee_affiliate_orders for all to authenticated using (account_id=public.current_account_id() and public.current_account_is_active()) with check (account_id=public.current_account_id() and public.current_account_is_active());
create policy tenant_isolation on public.shopee_affiliate_order_items for all to authenticated using (account_id=public.current_account_id() and public.current_account_is_active()) with check (account_id=public.current_account_id() and public.current_account_is_active());
create policy tenant_isolation on public.shopee_affiliate_sync_state for all to authenticated using (account_id=public.current_account_id() and public.current_account_is_active()) with check (account_id=public.current_account_id() and public.current_account_is_active());

commit;
