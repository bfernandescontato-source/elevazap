-- Observabilidade do whatsapp-service (investigação do "número surdo").
-- Só dados de diagnóstico; nenhuma regra de negócio lê estas tabelas.
-- Acesso apenas pelo service_role (RLS ligado, sem políticas).

create table if not exists public.whatsapp_obs_minutes (
  session_name text not null,
  account_id uuid null,
  minute timestamptz not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (session_name, minute)
);

create index if not exists whatsapp_obs_minutes_minute_idx
  on public.whatsapp_obs_minutes (minute);

alter table public.whatsapp_obs_minutes enable row level security;

-- Um episódio de silêncio = um incident_id; cada retrato do episódio
-- (detector de 20 min, cada pré-reinício) é uma linha.
create table if not exists public.whatsapp_obs_incidents (
  id uuid primary key,
  incident_id uuid not null,
  session_name text not null,
  account_id uuid null,
  kind text not null,
  reason text not null,
  level_minutes integer not null default 0,
  classification text not null,
  detected_at timestamptz not null,
  resolved_at timestamptz null,
  silence_ms bigint null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_obs_incidents_incident_idx
  on public.whatsapp_obs_incidents (incident_id);

create index if not exists whatsapp_obs_incidents_session_idx
  on public.whatsapp_obs_incidents (session_name, detected_at desc);

alter table public.whatsapp_obs_incidents enable row level security;
