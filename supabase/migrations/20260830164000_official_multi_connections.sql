-- Múltiplas contas da WhatsApp Cloud API no painel administrativo.
-- Segredos permanecem cifrados pela aplicação (AES-256-GCM); o banco nunca recebe plaintext.
begin;

create table if not exists public.official_connections (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 2 and 80),
  app_id text,
  business_portfolio_id text,
  waba_id text not null,
  phone_number_id text not null,
  encrypted_access_token text not null,
  encrypted_app_secret text not null,
  webhook_verify_token_hash text not null,
  graph_version text not null default 'v25.0',
  status text not null default 'connected' check (status in ('connected', 'error', 'disabled')),
  is_default boolean not null default false,
  display_phone_number text,
  verified_name text,
  waba_name text,
  quality_rating text,
  throughput_level text,
  last_tested_at timestamptz,
  webhook_verified_at timestamptz,
  app_subscribed boolean not null default false,
  last_error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists official_connections_phone_number_unique_idx
  on public.official_connections(phone_number_id);
create unique index if not exists official_connections_default_unique_idx
  on public.official_connections(is_default) where is_default;
create index if not exists official_connections_status_idx
  on public.official_connections(status, created_at desc);

alter table public.official_messages
  add column if not exists connection_id uuid references public.official_connections(id) on delete restrict;
alter table public.official_broadcasts
  add column if not exists connection_id uuid references public.official_connections(id) on delete restrict;
alter table public.official_flow_runs
  add column if not exists connection_id uuid references public.official_connections(id) on delete restrict;
alter table public.official_automations
  add column if not exists connection_id uuid references public.official_connections(id) on delete restrict;
alter table public.official_events
  add column if not exists connection_id uuid references public.official_connections(id) on delete restrict;
alter table public.official_external_sources
  add column if not exists connection_id uuid references public.official_connections(id) on delete restrict;

create index if not exists official_messages_connection_idx on public.official_messages(connection_id, created_at desc);
create index if not exists official_broadcasts_connection_idx on public.official_broadcasts(connection_id, created_at desc);
create index if not exists official_flow_runs_connection_idx on public.official_flow_runs(connection_id, created_at desc);

alter table public.official_connections enable row level security;
revoke all on public.official_connections from anon, authenticated;
grant select, insert, update on public.official_connections to service_role;
commit;
