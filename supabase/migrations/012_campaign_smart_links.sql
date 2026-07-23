create extension if not exists pgcrypto;

alter table campanhas
  add column if not exists public_slug text,
  add column if not exists status text not null default 'ativa',
  add column if not exists link_ativo boolean not null default true,
  add column if not exists fallback_type text not null default 'padrao',
  add column if not exists fallback_url text,
  add column if not exists reuse_available_groups boolean not null default false,
  add column if not exists allow_stale_participant_count boolean not null default true,
  add column if not exists total_accesses bigint not null default 0,
  add column if not exists total_redirects bigint not null default 0;

update campanhas
set public_slug = encode(gen_random_bytes(12), 'hex')
where public_slug is null;

alter table campanhas
  alter column public_slug set default encode(gen_random_bytes(12), 'hex'),
  alter column public_slug set not null;

create unique index if not exists campanhas_public_slug_idx on campanhas(public_slug);

do $$ begin
  alter table campanhas add constraint campanhas_status_check check (status in ('ativa', 'pausada', 'encerrada'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table campanhas add constraint campanhas_fallback_type_check check (fallback_type in ('padrao', 'url'));
exception when duplicate_object then null;
end $$;

alter table campanha_grupos
  add column if not exists position integer,
  add column if not exists manual_status text not null default 'disponivel',
  add column if not exists participant_limit integer,
  add column if not exists safety_margin integer not null default 0,
  add column if not exists invite_url text,
  add column if not exists participant_count integer,
  add column if not exists participants_synced_at timestamptz,
  add column if not exists participants_sync_error text,
  add column if not exists redirection_count bigint not null default 0,
  add column if not exists capacity_reached_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

with ordered as (
  select campanha_id, group_jid,
         row_number() over (partition by campanha_id order by created_at, group_jid)::integer as next_position
  from campanha_grupos
)
update campanha_grupos cg
set position = ordered.next_position
from ordered
where cg.campanha_id = ordered.campanha_id
  and cg.group_jid = ordered.group_jid
  and cg.position is null;

alter table campanha_grupos alter column position set not null;

do $$ begin
  alter table campanha_grupos add constraint campanha_grupos_manual_status_check check (manual_status in ('disponivel', 'cheio', 'pausado'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table campanha_grupos add constraint campanha_grupos_participant_limit_check check (participant_limit is null or participant_limit > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table campanha_grupos add constraint campanha_grupos_safety_margin_check check (safety_margin >= 0);
exception when duplicate_object then null;
end $$;

create index if not exists campanha_grupos_order_idx on campanha_grupos(campanha_id, position);

create table if not exists campaign_redirect_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campanhas(id) on delete cascade,
  group_jid text references grupos(group_jid) on delete set null,
  result text not null,
  reason text,
  utm jsonb not null default '{}'::jsonb,
  user_agent text,
  anonymous_session_id text,
  destination_url text,
  created_at timestamptz not null default now()
);

create index if not exists campaign_redirect_events_campaign_idx on campaign_redirect_events(campaign_id, created_at desc);
create index if not exists campaign_redirect_events_group_idx on campaign_redirect_events(group_jid, created_at desc);

create table if not exists group_participant_syncs (
  id uuid primary key default gen_random_uuid(),
  group_jid text not null references grupos(group_jid) on delete cascade,
  whatsapp_sender_id uuid references whatsapp_senders(id) on delete set null,
  participant_count integer,
  source text not null default 'baileys_group_metadata',
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists group_participant_syncs_group_idx on group_participant_syncs(group_jid, created_at desc);

alter table campaign_redirect_events enable row level security;
alter table group_participant_syncs enable row level security;

create or replace function resolve_campaign_redirect(
  p_slug text,
  p_utm jsonb default '{}'::jsonb,
  p_user_agent text default null,
  p_anonymous_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_campaign campanhas;
  selected_group campanha_grupos;
  target_url text;
  fallback_destination text;
  failure_reason text;
begin
  select * into selected_campaign
  from campanhas
  where public_slug = p_slug
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'not_found', true);
  end if;

  update campanhas
  set total_accesses = total_accesses + 1, updated_at = now()
  where id = selected_campaign.id;

  fallback_destination := case
    when selected_campaign.fallback_type = 'url' then selected_campaign.fallback_url
    else null
  end;

  if selected_campaign.status <> 'ativa' then
    failure_reason := case when selected_campaign.status = 'pausada' then 'campanha_pausada' else 'campanha_encerrada' end;
  elsif not selected_campaign.link_ativo then
    failure_reason := 'link_pausado';
  end if;

  if failure_reason is null then
    update campanha_grupos
    set capacity_reached_at = coalesce(capacity_reached_at, now()), updated_at = now()
    where campanha_id = selected_campaign.id
      and participant_limit is not null
      and participant_count is not null
      and participant_count >= greatest(0, participant_limit - safety_margin);

    select cg.* into selected_group
    from campanha_grupos cg
    where cg.campanha_id = selected_campaign.id
      and cg.manual_status = 'disponivel'
      and cg.invite_url like 'https://chat.whatsapp.com/%'
      and cg.participant_count is not null
      and (selected_campaign.allow_stale_participant_count or cg.participants_sync_error is null)
      and (cg.participant_limit is null or cg.participant_count is null or cg.participant_count < greatest(0, cg.participant_limit - cg.safety_margin))
      and (selected_campaign.reuse_available_groups or cg.capacity_reached_at is null)
    order by cg.position asc
    for update
    limit 1;

    if found then
      target_url := selected_group.invite_url;
      update campanha_grupos
      set redirection_count = redirection_count + 1, updated_at = now()
      where campanha_id = selected_campaign.id and group_jid = selected_group.group_jid;
      update campanhas
      set total_redirects = total_redirects + 1, updated_at = now()
      where id = selected_campaign.id;

      insert into campaign_redirect_events(campaign_id, group_jid, result, utm, user_agent, anonymous_session_id, destination_url)
      values (selected_campaign.id, selected_group.group_jid, 'redirecionado', coalesce(p_utm, '{}'::jsonb), p_user_agent, p_anonymous_session_id, target_url);

      return jsonb_build_object('ok', true, 'destination_url', target_url, 'campaign_id', selected_campaign.id, 'group_jid', selected_group.group_jid);
    end if;

    failure_reason := 'nenhum_grupo_disponivel';
  end if;

  insert into campaign_redirect_events(campaign_id, result, reason, utm, user_agent, anonymous_session_id, destination_url)
  values (selected_campaign.id, 'sem_redirecionamento', failure_reason, coalesce(p_utm, '{}'::jsonb), p_user_agent, p_anonymous_session_id, fallback_destination);

  return jsonb_build_object(
    'ok', false,
    'campaign_id', selected_campaign.id,
    'reason', failure_reason,
    'fallback_url', fallback_destination
  );
end;
$$;

revoke all on function resolve_campaign_redirect(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function resolve_campaign_redirect(text, jsonb, text, text) to service_role;

create or replace function get_campaign_redirect_metrics(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  daily_metrics jsonb;
  source_metrics jsonb;
  failure_count bigint;
begin
  select count(*) into failure_count
  from campaign_redirect_events
  where campaign_id = p_campaign_id
    and result <> 'redirecionado';

  select coalesce(jsonb_agg(jsonb_build_object('date', day, 'count', total) order by day desc), '[]'::jsonb)
  into daily_metrics
  from (
    select created_at::date as day, count(*) as total
    from campaign_redirect_events
    where campaign_id = p_campaign_id
    group by created_at::date
  ) daily_rows;

  select coalesce(jsonb_agg(jsonb_build_object('source', source, 'count', total) order by total desc, source asc), '[]'::jsonb)
  into source_metrics
  from (
    select coalesce(nullif(utm ->> 'utm_source', ''), 'Sem UTM') as source, count(*) as total
    from campaign_redirect_events
    where campaign_id = p_campaign_id
    group by coalesce(nullif(utm ->> 'utm_source', ''), 'Sem UTM')
  ) source_rows;

  return jsonb_build_object(
    'failures', failure_count,
    'daily', daily_metrics,
    'sources', source_metrics
  );
end;
$$;

revoke all on function get_campaign_redirect_metrics(uuid) from public, anon, authenticated;
grant execute on function get_campaign_redirect_metrics(uuid) to service_role;

notify pgrst, 'reload schema';
