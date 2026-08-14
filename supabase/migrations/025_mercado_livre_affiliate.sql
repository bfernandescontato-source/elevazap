begin;

alter table public.affiliate_integrations drop constraint if exists affiliate_integrations_provider_check;
alter table public.affiliate_integrations add constraint affiliate_integrations_provider_check
  check (provider in ('shopee','mercado_livre'));
alter table public.affiliate_integrations alter column app_id drop not null;
alter table public.affiliate_integrations alter column encrypted_app_secret drop not null;
alter table public.affiliate_integrations alter column credential_fingerprint drop not null;
alter table public.affiliate_integrations drop constraint if exists affiliate_integrations_status_check;
alter table public.affiliate_integrations add constraint affiliate_integrations_status_check
  check (status in ('pending','disconnected','connecting','connected','expired','error','disabled'));
alter table public.affiliate_integrations
  add column if not exists external_account_id text,
  add column if not exists external_account_label text,
  add column if not exists encrypted_auth_data text,
  add column if not exists auth_expires_at timestamptz,
  add column if not exists affiliate_tag text,
  add column if not exists extension_token_hash text;

alter table public.affiliate_link_cache drop constraint if exists affiliate_link_cache_provider_check;
alter table public.affiliate_link_cache add constraint affiliate_link_cache_provider_check
  check (provider in ('shopee','mercado_livre'));
alter table public.affiliate_link_cache alter column credential_fingerprint drop not null;
alter table public.affiliate_link_cache add column if not exists affiliate_tag text;
update public.affiliate_link_cache set affiliate_tag='' where affiliate_tag is null;
alter table public.affiliate_link_cache alter column affiliate_tag set default '';
alter table public.affiliate_link_cache alter column affiliate_tag set not null;
do $$
declare constraint_name text;
begin
  select conname into constraint_name from pg_constraint
    where conrelid='public.affiliate_link_cache'::regclass and contype='u' limit 1;
  if constraint_name is not null then execute format('alter table public.affiliate_link_cache drop constraint %I', constraint_name); end if;
end $$;
alter table public.affiliate_link_cache add constraint affiliate_link_cache_provider_product_tag_key
  unique(account_id, provider, credential_fingerprint, resolved_url_hash, affiliate_tag);

alter table public.offer_automations
  add column if not exists mercado_livre_conversion_enabled boolean not null default false;

alter table public.captured_offers
  add column if not exists mercado_livre_links jsonb not null default '[]'::jsonb,
  add column if not exists affiliate_provider text,
  add column if not exists catalog_product_id text,
  add column if not exists affiliate_tag text;
alter table public.captured_offers add constraint captured_offers_affiliate_provider_check
  check (affiliate_provider is null or affiliate_provider in ('shopee','mercado_livre','multiple'));

create table public.captured_offer_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  offer_id uuid not null references public.captured_offers(id) on delete cascade,
  provider text not null check (provider in ('shopee','mercado_livre')),
  position integer not null,
  original_url text not null,
  resolved_url text,
  item_id text,
  catalog_product_id text,
  affiliate_link text,
  affiliate_tag text,
  conversion_status text not null default 'pending'
    check (conversion_status in ('not_enabled','pending','resolving','generating','converted','failed','pending_reconnect')),
  conversion_error text,
  attempts integer not null default 0,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(offer_id, position),
  unique(offer_id, original_url)
);

create table public.affiliate_connection_nonces (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null check (provider in ('mercado_livre')),
  nonce_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.affiliate_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  provider text not null check (provider in ('mercado_livre')),
  offer_link_id uuid references public.captured_offer_links(id) on delete cascade,
  kind text not null default 'conversion' check (kind in ('connection_test','conversion')),
  input_url text not null,
  affiliate_tag text,
  status text not null default 'pending' check (status in ('pending','claimed','completed','failed','expired')),
  claimed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  affiliate_link text,
  resolved_url text,
  item_id text,
  catalog_product_id text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index captured_offer_links_offer_idx on public.captured_offer_links(account_id, offer_id, position);
create index captured_offer_links_item_idx on public.captured_offer_links(account_id, provider, item_id) where item_id is not null;
create index affiliate_connection_nonces_expiry_idx on public.affiliate_connection_nonces(expires_at) where used_at is null;
create index affiliate_generation_jobs_poll_idx on public.affiliate_generation_jobs(account_id, provider, status, created_at);

alter table public.captured_offer_links enable row level security;
alter table public.affiliate_connection_nonces enable row level security;
alter table public.affiliate_generation_jobs enable row level security;

grant select, insert, update, delete on public.captured_offer_links to authenticated, service_role;
grant select, insert, update, delete on public.affiliate_connection_nonces to authenticated, service_role;
grant select, insert, update, delete on public.affiliate_generation_jobs to authenticated, service_role;

create policy tenant_isolation on public.captured_offer_links for all to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active())
  with check (account_id=public.current_account_id() and public.current_account_is_active());
create policy tenant_isolation on public.affiliate_connection_nonces for all to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active())
  with check (account_id=public.current_account_id() and public.current_account_is_active());
create policy tenant_isolation on public.affiliate_generation_jobs for all to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active())
  with check (account_id=public.current_account_id() and public.current_account_is_active());

create or replace function public.enforce_captured_offer_link_account() returns trigger
language plpgsql set search_path=public as $$
declare parent_account uuid;
begin
  select account_id into parent_account from public.captured_offers where id=new.offer_id;
  if parent_account is distinct from new.account_id then raise exception 'cross-account offer link rejected'; end if;
  return new;
end $$;
create trigger tenant_captured_offer_link before insert or update on public.captured_offer_links
  for each row execute function public.enforce_captured_offer_link_account();

commit;

-- rollback (manual, before production): drop the three new tables, added columns/indexes,
-- restore provider/status constraints and reapply NOT NULL only after removing Mercado Livre rows.
