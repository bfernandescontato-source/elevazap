-- Fluxo = 1 template inicial + 1 Quick Reply + 1 resposta após clique (já existente em
-- official_quick_reply_actions). Não duplicamos a resposta: official_flows só referencia
-- quick_reply_action_id, reaproveitando 100% do envio/mídia/variável já construído.
create table if not exists public.official_flows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  initial_template_name text not null,
  initial_template_language text not null default 'pt_BR',
  variable_mapping jsonb not null default '{}'::jsonb,
  quick_reply_action_id uuid not null references public.official_quick_reply_actions(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma execução por contato. initial_meta_message_id é a correlação confiável no clique:
-- o webhook da Meta manda button.context.id = wamid da mensagem original respondida.
create table if not exists public.official_flow_runs (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.official_flows(id) on delete cascade,
  source text not null default 'manual',
  source_reference text,
  phone text not null,
  context jsonb not null default '{}'::jsonb,
  initial_meta_message_id text,
  status text not null default 'sent' check (status in ('sent', 'clicked', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  clicked_at timestamptz,
  completed_at timestamptz
);
create unique index if not exists official_flow_runs_message_idx
  on public.official_flow_runs(initial_meta_message_id) where initial_meta_message_id is not null;
create index if not exists official_flow_runs_flow_phone_idx on public.official_flow_runs(flow_id, phone);
create index if not exists official_flow_runs_created_idx on public.official_flow_runs(created_at desc);

alter table public.official_flows enable row level security;
alter table public.official_flow_runs enable row level security;
-- Nenhuma policy criada de propósito: sem acesso para authenticated/anon, só service role.
