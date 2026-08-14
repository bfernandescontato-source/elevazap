begin;

create table public.offer_automations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  whatsapp_sender_id uuid not null references public.whatsapp_senders(id) on delete restrict,
  enabled boolean not null default false,
  interval_minutes integer not null default 30 check (interval_minutes between 5 and 1440),
  operating_start time not null default '07:30',
  operating_end time not null default '22:30',
  timezone text not null default 'America/Sao_Paulo',
  keep_original_text boolean not null default true,
  keep_original_media boolean not null default true,
  avoid_duplicates boolean not null default true,
  deduplication_window_hours integer not null default 24 check (deduplication_window_hours between 1 and 720),
  ai_rewrite_enabled boolean not null default false,
  shopee_conversion_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id)
);

create table public.automation_source_groups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  automation_id uuid not null references public.offer_automations(id) on delete cascade,
  whatsapp_group_id text not null,
  priority integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(automation_id, whatsapp_group_id),
  foreign key(account_id, whatsapp_group_id) references public.grupos(account_id, group_jid) on delete restrict
);

create table public.automation_destinations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  automation_id uuid not null references public.offer_automations(id) on delete cascade,
  whatsapp_group_id text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(automation_id, whatsapp_group_id),
  foreign key(account_id, whatsapp_group_id) references public.grupos(account_id, group_jid) on delete restrict
);

create table public.captured_offers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  automation_id uuid not null references public.offer_automations(id) on delete cascade,
  source_type text not null default 'whatsapp' check (source_type in ('whatsapp','shopee_finder')),
  source_group_id text,
  source_message_id text not null,
  sender_id text,
  original_text text,
  original_media_url text,
  media_bucket text,
  media_path text,
  media_mime_type text,
  original_link text,
  links jsonb not null default '[]'::jsonb,
  shopee_links jsonb not null default '[]'::jsonb,
  content_hash text not null,
  resolved_url text,
  shop_id text,
  item_id text,
  affiliate_link text,
  affiliate_conversion_status text not null default 'not_enabled'
    check (affiliate_conversion_status in ('not_enabled','pending','converted','failed')),
  status text not null default 'captured'
    check (status in ('captured','processing','ready','scheduled','sending','sent','ignored','duplicate','processing_failed','send_failed')),
  error_code text,
  error_message text,
  captured_at timestamptz not null,
  processed_at timestamptz,
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, automation_id, source_message_id)
);

create table public.offer_deliveries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  offer_id uuid not null references public.captured_offers(id) on delete cascade,
  destination_group_id text not null,
  group_dispatch_id uuid references public.envios_grupo(id) on delete set null,
  link_used text,
  status text not null default 'pending'
    check (status in ('pending','scheduled','sending','sent','failed','uncertain','cancelled')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(offer_id, destination_group_id),
  foreign key(account_id, destination_group_id) references public.grupos(account_id, group_jid) on delete restrict
);

create index offer_automations_account_idx on public.offer_automations(account_id);
create index automation_source_lookup_idx on public.automation_source_groups(account_id, whatsapp_group_id) where enabled;
create index automation_destinations_automation_idx on public.automation_destinations(automation_id) where enabled;
create index captured_offers_account_idx on public.captured_offers(account_id, captured_at desc);
create index captured_offers_automation_idx on public.captured_offers(automation_id, captured_at desc);
create index captured_offers_source_message_idx on public.captured_offers(source_message_id);
create index captured_offers_item_idx on public.captured_offers(item_id) where item_id is not null;
create index captured_offers_status_schedule_idx on public.captured_offers(status, scheduled_at);
create index captured_offers_link_idx on public.captured_offers(account_id, original_link, captured_at desc) where original_link is not null;
create index captured_offers_hash_idx on public.captured_offers(account_id, content_hash, captured_at desc);
create index offer_deliveries_offer_idx on public.offer_deliveries(offer_id);
create index offer_deliveries_dispatch_idx on public.offer_deliveries(group_dispatch_id) where group_dispatch_id is not null;

alter table public.offer_automations enable row level security;
alter table public.automation_source_groups enable row level security;
alter table public.automation_destinations enable row level security;
alter table public.captured_offers enable row level security;
alter table public.offer_deliveries enable row level security;

create policy tenant_isolation on public.offer_automations for all to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active())
  with check (account_id=public.current_account_id() and public.current_account_is_active());
create policy tenant_isolation on public.automation_source_groups for all to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active())
  with check (account_id=public.current_account_id() and public.current_account_is_active());
create policy tenant_isolation on public.automation_destinations for all to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active())
  with check (account_id=public.current_account_id() and public.current_account_is_active());
create policy tenant_isolation on public.captured_offers for all to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active())
  with check (account_id=public.current_account_id() and public.current_account_is_active());
create policy tenant_isolation on public.offer_deliveries for all to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active())
  with check (account_id=public.current_account_id() and public.current_account_is_active());

create or replace function public.enforce_offer_autopilot_account() returns trigger
language plpgsql set search_path=public as $$
declare parent_account uuid;
begin
  if tg_table_name in ('automation_source_groups','automation_destinations') then
    select account_id into parent_account from public.offer_automations where id=new.automation_id;
  elsif tg_table_name='captured_offers' then
    select account_id into parent_account from public.offer_automations where id=new.automation_id;
  elsif tg_table_name='offer_deliveries' then
    select account_id into parent_account from public.captured_offers where id=new.offer_id;
  end if;
  if parent_account is distinct from new.account_id then raise exception 'cross-account reference rejected'; end if;
  return new;
end $$;

create trigger tenant_offer_source before insert or update on public.automation_source_groups for each row execute function public.enforce_offer_autopilot_account();
create trigger tenant_offer_destination before insert or update on public.automation_destinations for each row execute function public.enforce_offer_autopilot_account();
create trigger tenant_captured_offer before insert or update on public.captured_offers for each row execute function public.enforce_offer_autopilot_account();
create trigger tenant_offer_delivery before insert or update on public.offer_deliveries for each row execute function public.enforce_offer_autopilot_account();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('offer-media','offer-media',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

commit;
