create extension if not exists pgcrypto;

-- Support agent configuration
create table if not exists support_agent (
  id uuid primary key default gen_random_uuid(),
  whatsapp_session_id text not null unique,
  name text not null default 'Agente de Suporte',
  enabled boolean not null default false,
  system_prompt text not null default '',
  model text not null default 'gpt-4o-mini',
  temperature numeric not null default 0.7,
  max_history int not null default 20,
  aggregation_seconds int not null default 8,
  human_takeover_minutes int not null default 30,
  business_hours jsonb null,
  fallback_message text not null default 'Olá! Nosso atendimento funciona em horário comercial. Em breve retornaremos.',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One agent only (single-tenant app) — seed row created on first use

-- Support conversations
create table if not exists support_conversation (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references support_agent(id) on delete cascade,
  contact_jid text not null,
  contact_name text,
  status text not null check (status in ('open','ai_active','human_active','closed')) default 'open',
  ai_paused_until timestamptz null,
  last_message_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(agent_id, contact_jid)
);

-- Support messages (wa_message_id UNIQUE for idempotency)
create table if not exists support_message (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversation(id) on delete cascade,
  wa_message_id text unique not null,
  direction text not null check (direction in ('in','out')),
  sender text not null check (sender in ('contact','ai','human')),
  content text not null default '',
  tokens int null,
  created_at timestamptz default now()
);

-- Knowledge base
create table if not exists support_kb (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references support_agent(id) on delete cascade,
  title text not null,
  content text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Refund requests (created by AI tool, approved/rejected by human)
create table if not exists refund_request (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversation(id) on delete cascade,
  contact_jid text not null,
  elevapay_order_id text,
  amount numeric,
  reason text,
  status text not null check (status in ('pending','approved','rejected','processed')) default 'pending',
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists support_conversation_agent_idx on support_conversation(agent_id);
create index if not exists support_conversation_jid_idx on support_conversation(contact_jid);
create index if not exists support_conversation_status_idx on support_conversation(status);
create index if not exists support_conversation_last_msg_idx on support_conversation(last_message_at desc);
create index if not exists support_message_conversation_idx on support_message(conversation_id);
create index if not exists support_message_created_at_idx on support_message(created_at);
create index if not exists support_kb_agent_idx on support_kb(agent_id);
create index if not exists refund_request_conversation_idx on refund_request(conversation_id);
create index if not exists refund_request_status_idx on refund_request(status);

-- RLS
alter table support_agent enable row level security;
alter table support_conversation enable row level security;
alter table support_message enable row level security;
alter table support_kb enable row level security;
alter table refund_request enable row level security;
