-- Camada aditiva de atribuição para métricas do WhatsApp Oficial.
-- Não altera nem reclassifica registros históricos: registros sem contexto seguem como legado.

create table if not exists public.official_flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.official_flows(id) on delete cascade,
  step_key text not null,
  name text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  unique(flow_id, step_key),
  unique(flow_id, position)
);

create table if not exists public.official_flow_ctas (
  id uuid primary key default gen_random_uuid(),
  flow_step_id uuid not null references public.official_flow_steps(id) on delete cascade,
  cta_key text not null,
  label text not null,
  destination_url text,
  next_step_id uuid references public.official_flow_steps(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(flow_step_id, cta_key)
);

alter table public.official_messages
  add column if not exists source_type text check (source_type in ('automation','broadcast','manual','test','legacy')),
  add column if not exists source_id uuid,
  add column if not exists flow_id uuid references public.official_flows(id) on delete set null,
  add column if not exists step_id uuid references public.official_flow_steps(id) on delete set null,
  add column if not exists message_key text,
  add column if not exists template_id text,
  add column if not exists broadcast_id uuid references public.official_broadcasts(id) on delete set null,
  add column if not exists contact_id uuid,
  add column if not exists phone_number_id text,
  add column if not exists error_code text,
  add column if not exists error_reason text;

create index if not exists official_messages_analytics_idx
  on public.official_messages(flow_id, step_id, created_at desc);
create index if not exists official_messages_broadcast_analytics_idx
  on public.official_messages(broadcast_id, created_at desc) where broadcast_id is not null;

create table if not exists public.official_cta_clicks (
  id uuid primary key default gen_random_uuid(),
  click_id text not null,
  flow_run_id uuid references public.official_flow_runs(id) on delete set null,
  flow_id uuid references public.official_flows(id) on delete set null,
  step_id uuid references public.official_flow_steps(id) on delete set null,
  message_id uuid references public.official_messages(id) on delete set null,
  template_id text,
  cta_id uuid references public.official_flow_ctas(id) on delete set null,
  broadcast_id uuid references public.official_broadcasts(id) on delete set null,
  contact_id uuid,
  phone text,
  destination_url text,
  clicked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(click_id)
);
create index if not exists official_cta_clicks_analytics_idx on public.official_cta_clicks(flow_id, step_id, cta_id, clicked_at desc);
create index if not exists official_cta_clicks_broadcast_idx on public.official_cta_clicks(broadcast_id, clicked_at desc) where broadcast_id is not null;

alter table public.official_group_membership_events
  add column if not exists flow_id uuid references public.official_flows(id) on delete set null,
  add column if not exists step_id uuid references public.official_flow_steps(id) on delete set null,
  add column if not exists cta_id uuid references public.official_flow_ctas(id) on delete set null,
  add column if not exists broadcast_id uuid references public.official_broadcasts(id) on delete set null;
create unique index if not exists official_group_membership_events_dedupe_idx
  on public.official_group_membership_events(flow_run_id, group_jid, participant_phone, action, occurred_at);

alter table public.official_flow_steps enable row level security;
alter table public.official_flow_ctas enable row level security;
alter table public.official_cta_clicks enable row level security;
revoke all on public.official_flow_steps, public.official_flow_ctas, public.official_cta_clicks from anon, authenticated;
grant select, insert, update, delete on public.official_flow_steps, public.official_flow_ctas, public.official_cta_clicks to service_role;

-- Converte apenas a definição dos fluxos existentes em etapas. Não atribui dados antigos.
insert into public.official_flow_steps(flow_id, step_key, name, position)
select id, 'initial', 'Mensagem inicial', 1 from public.official_flows
on conflict (flow_id, step_key) do nothing;
insert into public.official_flow_steps(flow_id, step_key, name, position)
select id, 'follow_up', 'Próxima etapa', 2 from public.official_flows
on conflict (flow_id, step_key) do nothing;

insert into public.official_flow_ctas(flow_step_id, cta_key, label, next_step_id)
select initial.id, 'quick_reply', coalesce(a.button_label, a.payload, 'Continuar'), follow_up.id
from public.official_flows f
join public.official_flow_steps initial on initial.flow_id = f.id and initial.step_key = 'initial'
join public.official_flow_steps follow_up on follow_up.flow_id = f.id and follow_up.step_key = 'follow_up'
join public.official_quick_reply_actions a on a.id = f.quick_reply_action_id
on conflict (flow_step_id, cta_key) do nothing;

insert into public.official_flow_ctas(flow_step_id, cta_key, label, destination_url)
select step.id, 'destination', coalesce(a.button_config->>'text', 'Abrir link'), a.button_config->>'url'
from public.official_flows f
join public.official_flow_steps step on step.flow_id = f.id and step.step_key = 'follow_up'
join public.official_quick_reply_actions a on a.id = f.quick_reply_action_id
where a.button_config->>'type' = 'url'
on conflict (flow_step_id, cta_key) do nothing;
