-- Multi-tenant foundation. This migration is additive and preserves every row.
-- Precondition: take a logical backup and run verification/015_preflight.sql.
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid unique references auth.users(id) on delete restrict,
  name text not null,
  status text not null default 'active' check (status in ('active','past_due','suspended','cancelled','expired','refunded')),
  plan text not null default 'default',
  hubla_subscription_id text unique,
  subscription_started_at timestamptz,
  subscription_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_users add column if not exists account_id uuid references public.accounts(id) on delete restrict;

-- The oldest existing administrator owns the legacy account. No existing row is deleted.
do $$
declare v_owner uuid; v_account uuid;
begin
  select id into v_owner from public.app_users order by (role = 'admin') desc, created_at, id limit 1;
  if v_owner is not null then
    select id into v_account from public.accounts where owner_user_id = v_owner;
    if v_account is null then
      insert into public.accounts(owner_user_id, name, status, plan)
      select v_owner, coalesce(nullif(name,''), split_part(email,'@',1)), 'active', 'legacy'
      from public.app_users where id = v_owner returning id into v_account;
    end if;
    update public.app_users set account_id = v_account, updated_at = now() where account_id is null;
  end if;
end $$;

alter table public.app_users alter column account_id set not null;
create index if not exists app_users_account_id_idx on public.app_users(account_id);
create index if not exists accounts_status_idx on public.accounts(status);

-- Every tenant-owned table receives the legacy account before NOT NULL is enforced.
do $$
declare t text; v_legacy uuid;
begin
  select account_id into v_legacy from public.app_users order by created_at, id limit 1;
  if v_legacy is null then raise exception 'No legacy account available; aborting safely'; end if;
  foreach t in array array[
    'whatsapp_auth_creds','whatsapp_auth_keys','config','envios','grupos',
    'envios_grupo_lotes','envios_grupo','opt_outs','campanhas','campanha_grupos',
    'modelo_pastas','modelos_mensagem','webhook_rules','webhook_message_templates','webhook_events',
    'support_agent','support_conversation','support_message','support_kb','refund_request',
    'whatsapp_senders','whatsapp_sender_grupos','campaign_redirect_events',
    'group_participant_syncs','campaign_redirect_daily_metrics'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists account_id uuid references public.accounts(id) on delete restrict', t);
      execute format('update public.%I set account_id = $1 where account_id is null', t) using v_legacy;
      execute format('alter table public.%I alter column account_id set not null', t);
      execute format('create index if not exists %I on public.%I(account_id)', t || '_account_id_idx', t);
    end if;
  end loop;
end $$;

-- Natural identifiers may repeat in different tenants.
alter table public.campanha_grupos drop constraint if exists campanha_grupos_group_jid_fkey;
alter table public.whatsapp_sender_grupos drop constraint if exists whatsapp_sender_grupos_group_jid_fkey;
alter table public.campaign_redirect_events drop constraint if exists campaign_redirect_events_group_jid_fkey;
alter table public.group_participant_syncs drop constraint if exists group_participant_syncs_group_jid_fkey;
alter table public.grupos drop constraint if exists grupos_group_jid_key;
alter table public.grupos add constraint grupos_account_group_jid_key unique(account_id, group_jid);
alter table public.campanha_grupos add constraint campanha_grupos_account_group_fkey foreign key(account_id, group_jid) references public.grupos(account_id, group_jid) on delete cascade;
alter table public.whatsapp_sender_grupos add constraint whatsapp_sender_grupos_account_group_fkey foreign key(account_id, group_jid) references public.grupos(account_id, group_jid) on delete cascade;
alter table public.campaign_redirect_events add constraint campaign_redirect_events_account_group_fkey foreign key(account_id, group_jid) references public.grupos(account_id, group_jid) on delete cascade;
alter table public.group_participant_syncs add constraint group_participant_syncs_account_group_fkey foreign key(account_id, group_jid) references public.grupos(account_id, group_jid) on delete cascade;
alter table public.envios drop constraint if exists envios_idempotency_key_key;
alter table public.envios add constraint envios_account_idempotency_key_key unique(account_id, idempotency_key);

-- Queue claims are restricted to active subscriptions. Status transitions remain unchanged.
create or replace function public.claim_next_envio() returns public.envios
language plpgsql security definer set search_path = pg_catalog, public as $$
declare job public.envios;
begin
  select e.* into job from public.envios e join public.accounts a on a.id=e.account_id
  where e.status='pendente' and a.status='active' and e.scheduled_at<=now()
    and (e.next_attempt_at is null or e.next_attempt_at<=now())
  order by e.scheduled_at,e.created_at for update of e skip locked limit 1;
  if not found then return null; end if;
  update public.envios set status='enfileirado',claimed_at=now(),claim_token=gen_random_uuid(),updated_at=now()
  where id=job.id and account_id=job.account_id returning * into job;
  return job;
end $$;

create or replace function public.claim_next_envio_grupo() returns public.envios_grupo
language plpgsql security definer set search_path = pg_catalog, public as $$
declare job public.envios_grupo;
begin
  select e.* into job from public.envios_grupo e join public.accounts a on a.id=e.account_id
  where e.status='pendente' and a.status='active' and e.scheduled_at<=now()
    and (e.next_attempt_at is null or e.next_attempt_at<=now())
  order by e.scheduled_at,e.created_at for update of e skip locked limit 1;
  if not found then return null; end if;
  update public.envios_grupo set status='enfileirado',claimed_at=now(),claim_token=gen_random_uuid(),updated_at=now()
  where id=job.id and account_id=job.account_id returning * into job;
  update public.envios_grupo_lotes set status='processando',started_at=coalesce(started_at,now()),updated_at=now()
  where id=job.lote_id and account_id=job.account_id and status in ('pendente','processando');
  perform public.recalc_lote_counts(job.lote_id);
  return job;
end $$;

create table if not exists public.hubla_webhook_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  event_type text not null,
  account_id uuid references public.accounts(id) on delete restrict,
  email_hash text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'processing' check (status in ('processing','processed','ignored','error')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists hubla_webhook_events_account_idx on public.hubla_webhook_events(account_id, received_at desc);

create or replace function public.current_account_id() returns uuid
language sql stable security definer set search_path = public as $$
  select account_id from public.app_users where id = auth.uid() and status = 'active'
$$;
create or replace function public.current_account_is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_users u join public.accounts a on a.id = u.account_id
    where u.id = auth.uid() and u.status = 'active' and a.status = 'active'
  )
$$;

alter table public.accounts enable row level security;
alter table public.hubla_webhook_events enable row level security;
drop policy if exists accounts_read_own on public.accounts;
create policy accounts_read_own on public.accounts for select to authenticated
  using (id = public.current_account_id());

-- Replace permissive/legacy policies on tenant tables with a single account boundary.
do $$
declare t text; p record;
begin
  foreach t in array array[
    'app_users','whatsapp_auth_creds','whatsapp_auth_keys','config','envios','grupos',
    'envios_grupo_lotes','envios_grupo','opt_outs','campanhas','campanha_grupos',
    'modelo_pastas','modelos_mensagem','webhook_rules','webhook_message_templates','webhook_events',
    'support_agent','support_conversation','support_message','support_kb','refund_request',
    'whatsapp_senders','whatsapp_sender_grupos','campaign_redirect_events',
    'group_participant_syncs','campaign_redirect_daily_metrics'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
        execute format('drop policy if exists %I on public.%I', p.policyname, t);
      end loop;
      execute format('create policy tenant_isolation on public.%I for all to authenticated using (account_id = public.current_account_id() and public.current_account_is_active()) with check (account_id = public.current_account_id() and public.current_account_is_active())', t);
    end if;
  end loop;
end $$;

-- Cross-tenant foreign-key substitutions are rejected even through privileged server code.
create or replace function public.enforce_same_account() returns trigger
language plpgsql set search_path = public as $$
declare parent_account uuid;
begin
  if to_jsonb(new)->>tg_argv[1] is null then return new; end if;
  execute format('select account_id from public.%I where id = $1', tg_argv[0]) into parent_account
    using (to_jsonb(new)->>tg_argv[1])::uuid;
  if parent_account is distinct from new.account_id then raise exception 'cross-account reference rejected'; end if;
  return new;
end $$;

drop trigger if exists tenant_campaign_group on public.campanha_grupos;
create trigger tenant_campaign_group before insert or update on public.campanha_grupos for each row execute function public.enforce_same_account('campanhas','campanha_id');
drop trigger if exists tenant_model_folder on public.modelos_mensagem;
create trigger tenant_model_folder before insert or update on public.modelos_mensagem for each row execute function public.enforce_same_account('modelo_pastas','pasta_id');
drop trigger if exists tenant_group_item_batch on public.envios_grupo;
create trigger tenant_group_item_batch before insert or update on public.envios_grupo for each row execute function public.enforce_same_account('envios_grupo_lotes','lote_id');
drop trigger if exists tenant_webhook_template on public.webhook_message_templates;
create trigger tenant_webhook_template before insert or update on public.webhook_message_templates for each row execute function public.enforce_same_account('webhook_rules','webhook_rule_id');
drop trigger if exists tenant_support_conversation on public.support_conversation;
create trigger tenant_support_conversation before insert or update on public.support_conversation for each row execute function public.enforce_same_account('support_agent','agent_id');
drop trigger if exists tenant_support_message on public.support_message;
create trigger tenant_support_message before insert or update on public.support_message for each row execute function public.enforce_same_account('support_conversation','conversation_id');
drop trigger if exists tenant_support_kb on public.support_kb;
create trigger tenant_support_kb before insert or update on public.support_kb for each row execute function public.enforce_same_account('support_agent','agent_id');
drop trigger if exists tenant_refund_conversation on public.refund_request;
create trigger tenant_refund_conversation before insert or update on public.refund_request for each row execute function public.enforce_same_account('support_conversation','conversation_id');
drop trigger if exists tenant_sender_group on public.whatsapp_sender_grupos;
create trigger tenant_sender_group before insert or update on public.whatsapp_sender_grupos for each row execute function public.enforce_same_account('whatsapp_senders','whatsapp_sender_id');

-- Recreate auth trigger: Hubla/server provisioning must provide account_id in metadata.
create or replace function public.handle_new_app_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_account uuid;
begin
  v_account := nullif(new.raw_user_meta_data->>'account_id','')::uuid;
  if v_account is null then return new; end if;
  insert into public.app_users(id,email,name,role,status,approved_at,account_id)
  values (new.id, lower(new.email), nullif(trim(coalesce(new.raw_user_meta_data->>'name','')),''),
          'admin','active',now(),v_account)
  on conflict (id) do update set email=excluded.email,name=excluded.name,account_id=excluded.account_id,updated_at=now();
  return new;
end $$;

revoke all on function public.current_account_id() from public;
revoke all on function public.current_account_is_active() from public;
grant execute on function public.current_account_id(), public.current_account_is_active() to authenticated;
