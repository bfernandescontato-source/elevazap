-- Disparo 1x1: cada recipient dispara o mesmo startFlow() já usado no teste manual (fase A) —
-- nada de lógica de envio duplicada aqui, só orquestração em lote com concorrência limitada.
create table if not exists public.official_broadcasts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  flow_id uuid not null references public.official_flows(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'ready', 'processing', 'paused', 'completed', 'failed')),
  total_rows integer not null default 0,
  valid_recipients integer not null default 0,
  processed integer not null default 0,
  accepted integer not null default 0,
  failed integer not null default 0,
  skip_recipients_with_prior_run boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.official_broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.official_broadcasts(id) on delete cascade,
  flow_run_id uuid references public.official_flow_runs(id) on delete set null,
  phone text not null,
  row_data jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'processing', 'accepted', 'failed', 'skipped')),
  meta_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
-- Mesmo telefone não pode aparecer duas vezes no mesmo disparo (garantia de não-duplicado).
create unique index if not exists official_broadcast_recipients_unique_idx on public.official_broadcast_recipients(broadcast_id, phone);
create index if not exists official_broadcast_recipients_status_idx on public.official_broadcast_recipients(broadcast_id, status);

alter table public.official_broadcasts enable row level security;
alter table public.official_broadcast_recipients enable row level security;
-- Nenhuma policy criada de propósito: sem acesso para authenticated/anon, só service role.
