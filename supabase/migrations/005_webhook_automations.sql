create extension if not exists pgcrypto;

create table if not exists webhook_rules (
  id uuid primary key default gen_random_uuid(),
  webhook_token text unique not null default encode(gen_random_bytes(18), 'base64url'),
  name text not null,
  status text not null check (status in ('active','inactive')) default 'active',
  payload_format text not null default 'generic',
  auth_type text not null check (auth_type in ('none','header','body_api_key')) default 'none',
  auth_header_name text,
  auth_secret_hash text,
  selected_product_mode text not null check (selected_product_mode in ('all','specific')) default 'all',
  product_ids text[] not null default '{}',
  selected_offer_mode text not null check (selected_offer_mode in ('all','specific')) default 'all',
  offer_ids text[] not null default '{}',
  selected_event_types text[] not null default '{}',
  whatsapp_account_id text not null default 'default',
  fixed_variables jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists webhook_message_templates (
  id uuid primary key default gen_random_uuid(),
  webhook_rule_id uuid not null references webhook_rules(id) on delete cascade,
  event_type text not null,
  template_body text not null,
  status text not null check (status in ('active','inactive')) default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(webhook_rule_id, event_type)
);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  webhook_rule_id uuid references webhook_rules(id) on delete set null,
  external_event_id text,
  idempotency_key text,
  event_type text,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  conditions_result jsonb not null default '{}'::jsonb,
  http_status int,
  status text not null check (status in ('received','ignored','queued','processing','sent','success','failed','auth_error','validation_error','duplicated','uncertain')) default 'received',
  message text,
  error_message text,
  template_used text,
  rendered_message text,
  recipient_phone text,
  recipient_name text,
  recipient_email text,
  whatsapp_account_id text,
  envio_id uuid references envios(id) on delete set null,
  attempts int not null default 0,
  warnings text[] not null default '{}',
  received_at timestamptz default now(),
  processed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists webhook_rules_token_idx on webhook_rules(webhook_token);
create index if not exists webhook_rules_status_idx on webhook_rules(status);
create index if not exists webhook_events_rule_idx on webhook_events(webhook_rule_id);
create index if not exists webhook_events_status_idx on webhook_events(status);
create index if not exists webhook_events_event_type_idx on webhook_events(event_type);
create index if not exists webhook_events_idempotency_idx on webhook_events(idempotency_key);
create index if not exists webhook_events_created_at_idx on webhook_events(created_at);
create unique index if not exists webhook_events_rule_idempotency_unique
  on webhook_events(webhook_rule_id, idempotency_key)
  where idempotency_key is not null;

alter table webhook_rules enable row level security;
alter table webhook_message_templates enable row level security;
alter table webhook_events enable row level security;
