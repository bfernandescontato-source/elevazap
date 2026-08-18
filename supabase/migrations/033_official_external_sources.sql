-- Entrada externa pra leads de fora da Disparei (ex: roleta via Google Apps Script) iniciarem
-- um fluxo já existente. Nenhuma lógica de envio nova: source_key + secret identificam a origem
-- e resolvem um flow_id fixo (nunca vindo do request), e o processamento reaproveita o mesmo
-- startFlow() já usado pelo Disparo 1x1 (fase A/C).
create table if not exists public.official_external_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_key text not null,
  flow_id uuid not null references public.official_flows(id) on delete restrict,
  secret_hash text not null,
  fixed_content_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists official_external_sources_source_key_idx on public.official_external_sources(source_key);

-- Log de cada lead recebido + trava de idempotência: o Apps Script envia um UUID por lead em
-- X-Disparei-Idempotency-Key, e retry/duplo-submit com a mesma chave (na mesma origem) nunca
-- inicia um segundo fluxo — só incrementa duplicate_attempts e devolve o resultado já registrado.
-- "status" reflete só o que aconteceu na tentativa original (pending/accepted/failed); duplicata
-- não é um status próprio porque a linha da tentativa original é sempre a única que existe.
create table if not exists public.official_external_leads (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.official_external_sources(id) on delete cascade,
  idempotency_key text not null,
  raw_payload jsonb not null,
  full_name text,
  phone text,
  content_name text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'failed')),
  error text,
  flow_run_id uuid references public.official_flow_runs(id) on delete set null,
  duplicate_attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists official_external_leads_idem_idx on public.official_external_leads(source_id, idempotency_key);
create index if not exists official_external_leads_source_created_idx on public.official_external_leads(source_id, created_at desc);

alter table public.official_external_sources enable row level security;
alter table public.official_external_leads enable row level security;
-- Nenhuma policy criada de propósito: sem acesso para authenticated/anon, só service role.
