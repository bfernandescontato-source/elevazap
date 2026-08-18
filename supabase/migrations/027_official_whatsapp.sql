-- Módulo interno "WhatsApp Oficial": Hubla -> WhatsApp Cloud API oficial da Meta.
-- Uso restrito ao administrador da plataforma (ADMIN_EMAIL), fora do fluxo multi-tenant.
-- Por isso estas tabelas não têm account_id e não recebem policies para
-- authenticated/anon: apenas o backend (service role) lê e escreve aqui.

create table if not exists public.official_automations (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  product_id text,
  product_name text,
  template_name text not null,
  template_language text not null default 'pt_BR',
  variable_mapping jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists official_automations_lookup_idx
  on public.official_automations(event_type, product_id) where active;

create table if not exists public.official_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'hubla',
  provider_event_id text,
  event_type text,
  product_id text,
  product_name text,
  customer_name text,
  customer_phone text,
  payload jsonb not null default '{}'::jsonb,
  headers jsonb not null default '{}'::jsonb,
  status text not null default 'received'
    check (status in ('received', 'ignored', 'processing', 'processed', 'failed', 'duplicate')),
  error text,
  automation_id uuid references public.official_automations(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
-- Idempotência: mesmo provider+tipo+id nunca gera duas mensagens.
create unique index if not exists official_events_idempotency_idx
  on public.official_events(provider, event_type, provider_event_id)
  where provider_event_id is not null;
create index if not exists official_events_created_idx on public.official_events(created_at desc);

create table if not exists public.official_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.official_events(id) on delete set null,
  phone text not null,
  template_name text not null,
  template_language text not null,
  meta_message_id text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'accepted', 'delivered', 'read', 'failed')),
  error text,
  request_payload jsonb,
  response_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists official_messages_event_idx on public.official_messages(event_id);
create index if not exists official_messages_created_idx on public.official_messages(created_at desc);

alter table public.official_automations enable row level security;
alter table public.official_events enable row level security;
alter table public.official_messages enable row level security;
-- Nenhuma policy criada de propósito: sem acesso para authenticated/anon,
-- apenas o service role (backend) consulta estas tabelas.
