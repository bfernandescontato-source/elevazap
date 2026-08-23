-- Funil observável do WhatsApp Oficial:
-- Meta (enviada/entregue/lida/falhou) -> clique no CTA final -> entrada no grupo.
-- Todas as escritas acontecem apenas nos backends com service role.

alter table public.official_messages
  add column if not exists flow_run_id uuid references public.official_flow_runs(id) on delete set null,
  add column if not exists accepted_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists status_payload jsonb;

update public.official_messages
set accepted_at = coalesce(accepted_at, created_at)
where status = 'accepted' and accepted_at is null;

create index if not exists official_messages_meta_message_idx
  on public.official_messages(meta_message_id)
  where meta_message_id is not null;
create index if not exists official_messages_flow_run_idx
  on public.official_messages(flow_run_id)
  where flow_run_id is not null;

alter table public.official_broadcast_recipients
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists status_payload jsonb;
alter table public.official_broadcast_recipients
  drop constraint if exists official_broadcast_recipients_status_check;
alter table public.official_broadcast_recipients
  add constraint official_broadcast_recipients_status_check
  check (status in ('queued', 'processing', 'accepted', 'sent', 'delivered', 'read', 'failed', 'skipped'));
create index if not exists official_broadcast_recipients_message_idx
  on public.official_broadcast_recipients(meta_message_id)
  where meta_message_id is not null;

alter table public.official_flow_runs
  add column if not exists final_meta_message_id text,
  add column if not exists final_destination_url text,
  add column if not exists final_link_clicked_at timestamptz,
  add column if not exists joined_group_at timestamptz,
  add column if not exists joined_group_jid text;

create unique index if not exists official_flow_runs_final_message_idx
  on public.official_flow_runs(final_meta_message_id)
  where final_meta_message_id is not null;
create index if not exists official_flow_runs_final_click_idx
  on public.official_flow_runs(final_link_clicked_at desc)
  where final_link_clicked_at is not null;
create index if not exists official_flow_runs_joined_group_idx
  on public.official_flow_runs(joined_group_at desc)
  where joined_group_at is not null;

create table if not exists public.official_final_link_clicks (
  id uuid primary key default gen_random_uuid(),
  flow_run_id uuid not null references public.official_flow_runs(id) on delete cascade,
  destination_url text not null,
  clicked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists official_final_link_clicks_run_idx
  on public.official_final_link_clicks(flow_run_id, clicked_at desc);
create index if not exists official_final_link_clicks_created_idx
  on public.official_final_link_clicks(created_at desc);

create table if not exists public.official_group_membership_events (
  id uuid primary key default gen_random_uuid(),
  flow_run_id uuid not null references public.official_flow_runs(id) on delete cascade,
  final_link_click_id uuid references public.official_final_link_clicks(id) on delete set null,
  sender_id uuid references public.whatsapp_senders(id) on delete set null,
  group_jid text not null,
  participant_phone text not null,
  participant_jid text,
  action text not null check (action in ('add', 'remove')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists official_group_membership_events_run_idx
  on public.official_group_membership_events(flow_run_id, occurred_at desc);
create index if not exists official_group_membership_events_phone_idx
  on public.official_group_membership_events(participant_phone, occurred_at desc);

alter table public.official_final_link_clicks enable row level security;
alter table public.official_group_membership_events enable row level security;

-- O módulo é interno. Revoga o acesso direto e libera somente os backends.
revoke all on public.official_final_link_clicks from anon, authenticated;
revoke all on public.official_group_membership_events from anon, authenticated;
grant select, insert, update, delete on public.official_final_link_clicks to service_role;
grant select, insert, update, delete on public.official_group_membership_events to service_role;
