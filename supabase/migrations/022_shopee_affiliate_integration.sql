begin;

create table public.affiliate_integrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null check (provider in ('shopee')),
  app_id text not null,
  encrypted_app_secret text not null,
  credential_fingerprint text not null,
  status text not null default 'pending' check (status in ('pending','connected','error','disabled')),
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, provider)
);

create table public.affiliate_link_cache (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  provider text not null check (provider in ('shopee')),
  credential_fingerprint text not null,
  item_id text,
  resolved_url_hash text not null,
  resolved_url text not null,
  affiliate_link text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique(account_id, provider, credential_fingerprint, resolved_url_hash)
);

alter table public.offer_automations
  add column if not exists conversion_failure_policy text not null default 'pause'
    check (conversion_failure_policy in ('pause','send_original'));

alter table public.captured_offers
  add column if not exists processed_text text,
  add column if not exists affiliate_conversion_error text,
  add column if not exists affiliate_conversion_attempts integer not null default 0,
  add column if not exists affiliate_converted_at timestamptz;

alter table public.captured_offers drop constraint if exists captured_offers_affiliate_conversion_status_check;
alter table public.captured_offers add constraint captured_offers_affiliate_conversion_status_check
  check (affiliate_conversion_status in ('not_enabled','not_required','pending','resolving','generating','converted','failed'));

create index affiliate_integrations_account_idx on public.affiliate_integrations(account_id, provider);
create index affiliate_link_cache_lookup_idx on public.affiliate_link_cache(account_id, provider, credential_fingerprint, resolved_url_hash, expires_at);
create index affiliate_link_cache_item_idx on public.affiliate_link_cache(account_id, provider, item_id) where item_id is not null;
create index captured_offers_item_dedup_idx on public.captured_offers(account_id, item_id, captured_at desc) where item_id is not null;
create index captured_offers_conversion_idx on public.captured_offers(account_id, affiliate_conversion_status, captured_at desc);

alter table public.affiliate_integrations enable row level security;
alter table public.affiliate_link_cache enable row level security;

create policy tenant_isolation on public.affiliate_integrations for all to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active())
  with check (account_id=public.current_account_id() and public.current_account_is_active());
create policy tenant_isolation on public.affiliate_link_cache for all to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active())
  with check (account_id=public.current_account_id() and public.current_account_is_active());

commit;
