-- Campaign membership analytics starts at this migration's deployment.  We do
-- not infer entries or exits from historical participant snapshots or clicks.

create table if not exists public.campaign_participant_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  campaign_id uuid not null references public.campanhas(id) on delete cascade,
  group_jid text not null,
  whatsapp_sender_id uuid references public.whatsapp_senders(id) on delete set null,
  participant_jid text not null,
  action text not null check (action in ('add', 'remove')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (account_id, group_jid)
    references public.grupos(account_id, group_jid) on delete cascade
);

create index if not exists campaign_participant_events_campaign_occurred_idx
  on public.campaign_participant_events(campaign_id, occurred_at desc);
create index if not exists campaign_participant_events_group_occurred_idx
  on public.campaign_participant_events(account_id, group_jid, occurred_at desc);

-- Keep the tenant boundary valid even when this table is written by an
-- internal backend using the service role.
drop trigger if exists tenant_campaign_participant_event on public.campaign_participant_events;
create trigger tenant_campaign_participant_event
  before insert or update on public.campaign_participant_events
  for each row execute function public.enforce_same_account('campanhas', 'campaign_id');

alter table public.campaign_participant_events enable row level security;
revoke all on public.campaign_participant_events from anon, authenticated;
grant select, insert, update, delete on public.campaign_participant_events to service_role;

notify pgrst, 'reload schema';
