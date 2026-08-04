begin;

create extension if not exists pgcrypto;

-- This migration is intentionally corrective and cumulative. Migration 012 may
-- already exist in deployed environments, so no historical migration is edited.
alter table public.campanhas
  add column if not exists public_slug text,
  add column if not exists status text not null default 'ativa',
  add column if not exists link_ativo boolean not null default true,
  add column if not exists fallback_type text not null default 'padrao',
  add column if not exists fallback_url text,
  add column if not exists reuse_available_groups boolean not null default false,
  add column if not exists allow_stale_participant_count boolean not null default true,
  add column if not exists participant_data_max_age_seconds integer not null default 900,
  add column if not exists participant_data_stale_grace_seconds integer not null default 3600,
  add column if not exists stale_participant_safety_margin integer not null default 10,
  add column if not exists public_rate_limit_per_minute integer not null default 120,
  add column if not exists total_accesses bigint not null default 0,
  add column if not exists total_redirects bigint not null default 0;

update public.campanhas
set public_slug = encode(gen_random_bytes(12), 'hex')
where public_slug is null;

alter table public.campanhas
  alter column public_slug set default encode(gen_random_bytes(12), 'hex'),
  alter column public_slug set not null;

create unique index if not exists campanhas_public_slug_idx on public.campanhas(public_slug);

do $$ begin
  alter table public.campanhas add constraint campanhas_status_check
    check (status in ('ativa', 'pausada', 'encerrada'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.campanhas add constraint campanhas_fallback_type_check
    check (fallback_type in ('padrao', 'url'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.campanhas add constraint campanhas_participant_data_max_age_check
    check (participant_data_max_age_seconds between 60 and 86400);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.campanhas add constraint campanhas_public_rate_limit_check
    check (public_rate_limit_per_minute between 10 and 10000);
exception when duplicate_object then null;
end $$;

alter table public.campanha_grupos
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
  from public.campanha_grupos
)
update public.campanha_grupos cg
set position = ordered.next_position
from ordered
where cg.campanha_id = ordered.campanha_id
  and cg.group_jid = ordered.group_jid
  and cg.position is null;

alter table public.campanha_grupos alter column position set not null;
create index if not exists campanha_grupos_order_idx on public.campanha_grupos(campanha_id, position);

do $$ begin
  alter table public.campanha_grupos add constraint campanha_grupos_manual_status_check
    check (manual_status in ('disponivel', 'cheio', 'pausado'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.campanha_grupos add constraint campanha_grupos_participant_limit_check
    check (participant_limit is null or participant_limit > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.campanha_grupos add constraint campanha_grupos_safety_margin_check
    check (safety_margin >= 0);
exception when duplicate_object then null;
end $$;

create table if not exists public.campaign_redirect_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campanhas(id) on delete cascade,
  group_jid text references public.grupos(group_jid) on delete set null,
  result text not null,
  reason text,
  utm jsonb not null default '{}'::jsonb,
  user_agent text,
  anonymous_session_id text,
  destination_url text,
  created_at timestamptz not null default now()
);

create index if not exists campaign_redirect_events_campaign_idx on public.campaign_redirect_events(campaign_id, created_at desc);
create index if not exists campaign_redirect_events_group_idx on public.campaign_redirect_events(group_jid, created_at desc);

create table if not exists public.group_participant_syncs (
  id uuid primary key default gen_random_uuid(),
  group_jid text not null references public.grupos(group_jid) on delete cascade,
  whatsapp_sender_id uuid references public.whatsapp_senders(id) on delete set null,
  participant_count integer,
  source text not null default 'baileys_group_metadata',
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists group_participant_syncs_group_idx on public.group_participant_syncs(group_jid, created_at desc);
create index if not exists group_participant_syncs_created_idx on public.group_participant_syncs(created_at);

create table if not exists public.campaign_redirect_daily_metrics (
  campaign_id uuid not null references public.campanhas(id) on delete cascade,
  day date not null,
  source text not null default 'Sem UTM',
  result text not null,
  total bigint not null default 0,
  primary key (campaign_id, day, source, result)
);

alter table public.campaign_redirect_events enable row level security;
alter table public.group_participant_syncs enable row level security;
alter table public.campaign_redirect_daily_metrics enable row level security;

alter table public.envios
  add column if not exists processing_deadline_at timestamptz,
  add column if not exists reconciliation_required boolean not null default false,
  add column if not exists last_error_code text;

alter table public.envios_grupo
  add column if not exists processing_deadline_at timestamptz,
  add column if not exists reconciliation_required boolean not null default false,
  add column if not exists last_error_code text;

alter table public.envios_grupo_lotes
  add column if not exists pausados integer not null default 0,
  add column if not exists cancelados integer not null default 0;

alter table public.envios_grupo_lotes drop constraint if exists envios_grupo_lotes_status_check;
alter table public.envios_grupo_lotes add constraint envios_grupo_lotes_status_check
  check (status in ('pendente','processando','sucesso','erro','pausado','cancelado','incerto','parcial','concluido_com_erros'));

create or replace function public.acquire_service_lock(p_id text, p_instance_id text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare acquired boolean;
begin
  if p_id is null or length(p_id) not between 1 and 120
     or p_instance_id is null or length(p_instance_id) not between 1 and 200
     or p_ttl_seconds not between 5 and 300 then
    raise exception 'Parâmetros inválidos para aquisição do lock.' using errcode = '22023';
  end if;
  insert into public.service_lock(id, instance_id, heartbeat, created_at, updated_at)
  values (p_id, p_instance_id, now(), now(), now())
  on conflict (id) do update
  set instance_id = excluded.instance_id, heartbeat = now(), updated_at = now()
  where public.service_lock.heartbeat < now() - make_interval(secs => p_ttl_seconds)
     or public.service_lock.instance_id = p_instance_id;
  select instance_id = p_instance_id into acquired from public.service_lock where id = p_id;
  return coalesce(acquired, false);
end;
$$;

create or replace function public.renew_service_lock(p_id text, p_instance_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_id is null or p_instance_id is null then
    raise exception 'Parâmetros inválidos para renovação do lock.' using errcode = '22023';
  end if;
  update public.service_lock set heartbeat = now(), updated_at = now()
  where id = p_id and instance_id = p_instance_id;
  return found;
end;
$$;

create or replace function public.increment_rate_limit(
  p_key text,
  p_scope text,
  p_window_start timestamptz,
  p_expires_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare current_count integer;
begin
  if p_key is null or length(p_key) not between 1 and 256
     or p_scope is null or length(p_scope) not between 1 and 120
     or p_window_start is null or p_expires_at is null
     or p_expires_at <= p_window_start then
    raise exception 'Parâmetros inválidos para rate limit.' using errcode = '22023';
  end if;
  delete from public.rate_limits where expires_at < now();
  insert into public.rate_limits(key, scope, count, window_start, expires_at, created_at, updated_at)
  values (p_key, p_scope, 1, p_window_start, p_expires_at, now(), now())
  on conflict(key, scope, window_start) do update
  set count = public.rate_limits.count + 1, updated_at = now()
  returning count into current_count;
  return current_count;
end;
$$;

create or replace function public.claim_next_envio()
returns public.envios
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare job public.envios;
begin
  select * into job from public.envios
  where status = 'pendente'
    and scheduled_at <= now()
    and (next_attempt_at is null or next_attempt_at <= now())
  order by scheduled_at, created_at
  for update skip locked limit 1;
  if not found then return null; end if;
  update public.envios set status = 'enfileirado', claimed_at = now(),
    processing_deadline_at = now() + interval '2 minutes', claim_token = gen_random_uuid(), updated_at = now()
  where id = job.id returning * into job;
  return job;
end;
$$;

create or replace function public.claim_next_envio_grupo()
returns public.envios_grupo
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare job public.envios_grupo;
begin
  select * into job from public.envios_grupo
  where status = 'pendente'
    and scheduled_at <= now()
    and (next_attempt_at is null or next_attempt_at <= now())
  order by scheduled_at, created_at
  for update skip locked limit 1;
  if not found then return null; end if;
  update public.envios_grupo set status = 'enfileirado', claimed_at = now(),
    processing_deadline_at = now() + interval '2 minutes', claim_token = gen_random_uuid(), updated_at = now()
  where id = job.id returning * into job;
  update public.envios_grupo_lotes set status = 'processando', started_at = coalesce(started_at, now()), updated_at = now()
  where id = job.lote_id and status in ('pendente', 'processando');
  perform public.recalc_lote_counts(job.lote_id);
  return job;
end;
$$;

create or replace function public.clear_whatsapp_auth(p_session_name text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_session_name is null or length(p_session_name) not between 1 and 160 then
    raise exception 'Sessão inválida.' using errcode = '22023';
  end if;
  delete from public.whatsapp_auth_keys where session_name = p_session_name;
  delete from public.whatsapp_auth_creds where session_name = p_session_name;
end;
$$;

create or replace function public.recalc_lote_counts(p_lote_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare c record;
begin
  if p_lote_id is null then raise exception 'Lote inválido.' using errcode = '22023'; end if;
  select count(*)::integer as total,
    count(*) filter (where status = 'sucesso')::integer as enviados,
    count(*) filter (where status = 'erro')::integer as erros,
    count(*) filter (where status = 'pendente')::integer as pendentes,
    count(*) filter (where status = 'enfileirado')::integer as enfileirados,
    count(*) filter (where status = 'processando')::integer as processando,
    count(*) filter (where status = 'incerto')::integer as incertos,
    count(*) filter (where status = 'pausado')::integer as pausados,
    count(*) filter (where status = 'cancelado')::integer as cancelados
  into c from public.envios_grupo where lote_id = p_lote_id;

  update public.envios_grupo_lotes
  set total = c.total, enviados = c.enviados, erros = c.erros,
      pendentes = c.pendentes, enfileirados = c.enfileirados,
      processando = c.processando, incertos = c.incertos,
      pausados = c.pausados, cancelados = c.cancelados,
      status = case
        when c.incertos > 0 then 'incerto'
        when c.processando > 0 or c.enfileirados > 0 then 'processando'
        when c.pendentes > 0 then 'pendente'
        when c.pausados > 0 then 'pausado'
        when c.total > 0 and c.cancelados = c.total then 'cancelado'
        when c.total > 0 and c.enviados = c.total then 'sucesso'
        when c.total > 0 and c.enviados + c.erros + c.cancelados = c.total and c.erros > 0 and c.enviados > 0 then 'concluido_com_erros'
        when c.total > 0 and c.enviados + c.erros + c.cancelados = c.total and c.erros > 0 then 'erro'
        when c.total > 0 and c.enviados + c.cancelados = c.total and c.enviados > 0 then 'parcial'
        else 'pendente'
      end,
      finished_at = case
        when c.total > 0 and c.pendentes + c.enfileirados + c.processando + c.pausados + c.incertos = 0
          then coalesce(finished_at, now())
        else null
      end,
      updated_at = now()
  where id = p_lote_id;
end;
$$;

create or replace function public.create_campaign_atomic(p_nome text, p_group_jids text[], p_sender_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare clean_jids text[]; created public.campanhas; missing_count integer;
begin
  if nullif(btrim(p_nome), '') is null or length(btrim(p_nome)) > 120 then
    raise exception 'Nome da campanha inválido.' using errcode = '22023';
  end if;
  select array_agg(jid order by first_position) into clean_jids
  from (select jid, min(position) first_position from unnest(p_group_jids) with ordinality as u(jid, position) group by jid) dedup;
  if coalesce(cardinality(clean_jids), 0) = 0 or exists (select 1 from unnest(clean_jids) jid where jid !~ '^[0-9]+(-[0-9]+)?@g\.us$') then
    raise exception 'Grupos inválidos.' using errcode = '22023';
  end if;
  select count(*) into missing_count from unnest(clean_jids) jid
  where not exists (select 1 from public.grupos g where g.group_jid = jid);
  if missing_count > 0 then raise exception 'Um ou mais grupos não foram encontrados.' using errcode = '23503'; end if;
  if p_sender_id is not null and not exists (select 1 from public.whatsapp_senders where id = p_sender_id) then
    raise exception 'Número responsável não encontrado.' using errcode = '23503';
  end if;
  insert into public.campanhas(nome, whatsapp_sender_id)
  values (btrim(p_nome), p_sender_id) returning * into created;
  insert into public.campanha_grupos(campanha_id, group_jid, position)
  select created.id, jid, position::integer from unnest(clean_jids) with ordinality as u(jid, position);
  return jsonb_build_object('ok', true, 'campanha', to_jsonb(created));
end;
$$;

create or replace function public.replace_campaign_groups_atomic(p_campanha_id uuid, p_group_jids text[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare clean_jids text[]; missing_count integer;
begin
  if not exists (select 1 from public.campanhas where id = p_campanha_id for update) then
    raise exception 'Campanha não encontrada.' using errcode = 'P0002';
  end if;
  select array_agg(jid order by first_position) into clean_jids
  from (select jid, min(position) first_position from unnest(p_group_jids) with ordinality as u(jid, position) group by jid) dedup;
  if coalesce(cardinality(clean_jids), 0) = 0 or exists (select 1 from unnest(clean_jids) jid where jid !~ '^[0-9]+(-[0-9]+)?@g\.us$') then
    raise exception 'Grupos inválidos.' using errcode = '22023';
  end if;
  select count(*) into missing_count from unnest(clean_jids) jid
  where not exists (select 1 from public.grupos g where g.group_jid = jid);
  if missing_count > 0 then raise exception 'Um ou mais grupos não foram encontrados.' using errcode = '23503'; end if;
  delete from public.campanha_grupos where campanha_id = p_campanha_id and group_jid <> all(clean_jids);
  insert into public.campanha_grupos(campanha_id, group_jid, position)
  select p_campanha_id, jid, position::integer from unnest(clean_jids) with ordinality as u(jid, position)
  on conflict(campanha_id, group_jid) do update set position = excluded.position, updated_at = now();
  return jsonb_build_object('ok', true, 'group_count', cardinality(clean_jids));
end;
$$;

create or replace function public.create_group_lote_atomic(
  p_titulo text,
  p_campanha_id uuid,
  p_group_jids text[],
  p_sender_id uuid,
  p_tipo text,
  p_texto text,
  p_legenda text,
  p_mention_all boolean,
  p_scheduled_at timestamptz,
  p_media jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare clean_jids text[]; created public.envios_grupo_lotes; selected_sender public.whatsapp_senders; missing_count integer;
begin
  if nullif(btrim(p_titulo), '') is null or length(btrim(p_titulo)) > 120 then raise exception 'Título inválido.' using errcode = '22023'; end if;
  if p_tipo not in ('texto','imagem','video','audio','audio_voz','documento') then raise exception 'Tipo inválido.' using errcode = '22023'; end if;
  if p_tipo = 'texto' and nullif(btrim(coalesce(p_texto, '')), '') is null then raise exception 'Mensagem obrigatória.' using errcode = '22023'; end if;
  if p_tipo <> 'texto' and p_media is null then raise exception 'Mídia obrigatória.' using errcode = '22023'; end if;
  if p_scheduled_at < now() - interval '1 minute' then raise exception 'Agendamento no passado.' using errcode = '22023'; end if;
  select array_agg(jid order by first_position) into clean_jids
  from (select jid, min(position) first_position from unnest(p_group_jids) with ordinality as u(jid, position) group by jid) dedup;
  if coalesce(cardinality(clean_jids), 0) = 0 or exists (select 1 from unnest(clean_jids) jid where jid !~ '^[0-9]+(-[0-9]+)?@g\.us$') then raise exception 'Destinatários inválidos.' using errcode = '22023'; end if;
  select count(*) into missing_count from unnest(clean_jids) jid where not exists (select 1 from public.grupos g where g.group_jid = jid);
  if missing_count > 0 then raise exception 'Um ou mais grupos não foram encontrados.' using errcode = '23503'; end if;
  if p_campanha_id is not null and not exists (select 1 from public.campanhas where id = p_campanha_id) then raise exception 'Campanha não encontrada.' using errcode = '23503'; end if;
  if p_sender_id is not null then
    select * into selected_sender from public.whatsapp_senders where id = p_sender_id;
    if not found then raise exception 'Número responsável não encontrado.' using errcode = '23503'; end if;
  end if;
  insert into public.envios_grupo_lotes(
    titulo, campanha_id, whatsapp_sender_id, whatsapp_session_name, tipo, texto, legenda, mention_all,
    media_bucket, media_path, file_name, mime_type, file_size_bytes, total, pendentes, scheduled_at
  ) values (
    btrim(p_titulo), p_campanha_id, selected_sender.id, selected_sender.session_name, p_tipo, p_texto, p_legenda, coalesce(p_mention_all, false),
    p_media->>'bucket', p_media->>'storage_path', p_media->>'file_name', p_media->>'mime_type', nullif(p_media->>'file_size_bytes','')::bigint,
    cardinality(clean_jids), cardinality(clean_jids), coalesce(p_scheduled_at, now())
  ) returning * into created;
  insert into public.envios_grupo(
    lote_id, whatsapp_sender_id, whatsapp_session_name, group_jid, nome_grupo, tipo, texto, legenda, mention_all,
    media_bucket, media_path, file_name, mime_type, file_size_bytes, scheduled_at
  )
  select created.id, selected_sender.id, selected_sender.session_name, jid, coalesce(g.nome, jid), p_tipo, p_texto, p_legenda,
    coalesce(p_mention_all, false), p_media->>'bucket', p_media->>'storage_path', p_media->>'file_name', p_media->>'mime_type',
    nullif(p_media->>'file_size_bytes','')::bigint, coalesce(p_scheduled_at, now())
  from unnest(clean_jids) jid join public.grupos g on g.group_jid = jid;
  return jsonb_build_object('ok', true, 'lote', to_jsonb(created));
end;
$$;

create or replace function public.transition_lote_atomic(p_lote_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare current_lote public.envios_grupo_lotes; result_lote public.envios_grupo_lotes;
begin
  select * into current_lote from public.envios_grupo_lotes where id = p_lote_id for update;
  if not found then raise exception 'Lote não encontrado.' using errcode = 'P0002'; end if;
  if p_action = 'pause' then
    if current_lote.status not in ('pendente','processando') then raise exception 'Este lote não pode ser pausado.' using errcode = '22023'; end if;
    update public.envios_grupo set status = 'pausado', claim_token = null, updated_at = now()
    where lote_id = p_lote_id and status in ('pendente','enfileirado');
  elsif p_action = 'resume' then
    if current_lote.status <> 'pausado' then raise exception 'Este lote não pode ser retomado.' using errcode = '22023'; end if;
    update public.envios_grupo set status = 'pendente', claim_token = null, next_attempt_at = null, updated_at = now()
    where lote_id = p_lote_id and status = 'pausado';
    if not found then raise exception 'O lote não possui itens pausados.' using errcode = '22023'; end if;
  elsif p_action = 'cancel' then
    if current_lote.status in ('sucesso','erro','cancelado','parcial','concluido_com_erros') then raise exception 'Este lote não pode ser cancelado.' using errcode = '22023'; end if;
    update public.envios_grupo set status = 'cancelado', claim_token = null, updated_at = now()
    where lote_id = p_lote_id and status in ('pendente','enfileirado','pausado');
    if not found and current_lote.status <> 'processando' then raise exception 'O lote não possui itens canceláveis.' using errcode = '22023'; end if;
  else
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  perform public.recalc_lote_counts(p_lote_id);
  select * into result_lote from public.envios_grupo_lotes where id = p_lote_id;
  return jsonb_build_object('ok', true, 'lote', to_jsonb(result_lote));
end;
$$;

drop function if exists public.resolve_campaign_redirect(text, jsonb, text, text);
create function public.resolve_campaign_redirect(
  p_slug text,
  p_utm jsonb default '{}'::jsonb,
  p_user_agent text default null,
  p_anonymous_session_id text default null,
  p_rate_limit_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare selected_campaign public.campanhas; selected_group public.campanha_grupos; target_url text; fallback_destination text;
  failure_reason text; source_name text; request_count integer; window_start timestamptz; expires_at timestamptz; stale_margin integer;
begin
  if p_slug is null or length(p_slug) not between 8 and 128 then return jsonb_build_object('ok', false, 'not_found', true); end if;
  select * into selected_campaign from public.campanhas where public_slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'not_found', true); end if;

  if p_rate_limit_key is not null then
    window_start := date_trunc('minute', now()); expires_at := window_start + interval '2 minutes';
    insert into public.rate_limits(key, scope, count, window_start, expires_at, created_at, updated_at)
    values (left(p_rate_limit_key, 256), 'campaign_link:' || selected_campaign.id::text, 1, window_start, expires_at, now(), now())
    on conflict(key, scope, window_start) do update set count = public.rate_limits.count + 1, updated_at = now()
    returning count into request_count;
    if request_count > selected_campaign.public_rate_limit_per_minute then
      return jsonb_build_object('ok', false, 'rate_limited', true, 'reason', 'muitas_tentativas');
    end if;
  end if;

  update public.campanhas set total_accesses = total_accesses + 1, updated_at = now() where id = selected_campaign.id;
  fallback_destination := case when selected_campaign.fallback_type = 'url' then selected_campaign.fallback_url else null end;
  if selected_campaign.status <> 'ativa' then failure_reason := case when selected_campaign.status = 'pausada' then 'campanha_pausada' else 'campanha_encerrada' end;
  elsif not selected_campaign.link_ativo then failure_reason := 'link_pausado'; end if;

  if failure_reason is null then
    select cg.* into selected_group from public.campanha_grupos cg
    where cg.campanha_id = selected_campaign.id
      and cg.manual_status = 'disponivel'
      and cg.invite_url like 'https://chat.whatsapp.com/%'
      and cg.participant_count is not null
      and cg.participants_synced_at is not null
      and (
        cg.participants_synced_at >= now() - make_interval(secs => selected_campaign.participant_data_max_age_seconds)
        or (selected_campaign.allow_stale_participant_count and cg.participants_synced_at >= now() - make_interval(secs => selected_campaign.participant_data_max_age_seconds + selected_campaign.participant_data_stale_grace_seconds))
      )
      and (selected_campaign.reuse_available_groups or cg.capacity_reached_at is null)
      and (
        cg.participant_limit is null
        or cg.participant_count < greatest(0, cg.participant_limit - cg.safety_margin - case when cg.participants_synced_at < now() - make_interval(secs => selected_campaign.participant_data_max_age_seconds) then selected_campaign.stale_participant_safety_margin else 0 end)
      )
    order by cg.position asc limit 1;
    if found then
      target_url := selected_group.invite_url;
      update public.campanha_grupos set redirection_count = redirection_count + 1, updated_at = now()
      where campanha_id = selected_campaign.id and group_jid = selected_group.group_jid;
      update public.campanhas set total_redirects = total_redirects + 1, updated_at = now() where id = selected_campaign.id;
    else failure_reason := 'nenhum_grupo_confiavel'; end if;
  end if;

  source_name := coalesce(nullif(coalesce(p_utm, '{}'::jsonb)->>'utm_source', ''), 'Sem UTM');
  insert into public.campaign_redirect_events(campaign_id, group_jid, result, reason, utm, user_agent, anonymous_session_id, destination_url)
  values (selected_campaign.id, selected_group.group_jid, case when target_url is not null then 'redirecionado' else 'sem_redirecionamento' end,
    failure_reason, coalesce(p_utm, '{}'::jsonb), left(p_user_agent, 500), left(p_anonymous_session_id, 200), coalesce(target_url, fallback_destination));
  insert into public.campaign_redirect_daily_metrics(campaign_id, day, source, result, total)
  values (selected_campaign.id, current_date, source_name, case when target_url is not null then 'redirecionado' else 'sem_redirecionamento' end, 1)
  on conflict(campaign_id, day, source, result) do update set total = public.campaign_redirect_daily_metrics.total + 1;
  if target_url is not null then return jsonb_build_object('ok', true, 'destination_url', target_url, 'campaign_id', selected_campaign.id, 'group_jid', selected_group.group_jid); end if;
  return jsonb_build_object('ok', false, 'campaign_id', selected_campaign.id, 'reason', failure_reason, 'fallback_url', fallback_destination);
end;
$$;

create or replace function public.get_campaign_redirect_metrics(p_campaign_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'failures', coalesce(sum(total) filter (where result <> 'redirecionado'), 0),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('date', day, 'count', total) order by day desc) from (select day, sum(total) total from public.campaign_redirect_daily_metrics where campaign_id = p_campaign_id group by day) d), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'count', total) order by total desc, source) from (select source, sum(total) total from public.campaign_redirect_daily_metrics where campaign_id = p_campaign_id group by source) s), '[]'::jsonb)
  ) from public.campaign_redirect_daily_metrics where campaign_id = p_campaign_id;
$$;

insert into public.campaign_redirect_daily_metrics(campaign_id, day, source, result, total)
select campaign_id, created_at::date, coalesce(nullif(utm->>'utm_source',''), 'Sem UTM'), result, count(*)
from public.campaign_redirect_events
group by campaign_id, created_at::date, coalesce(nullif(utm->>'utm_source',''), 'Sem UTM'), result
on conflict(campaign_id, day, source, result) do update set total = excluded.total;

create or replace function public.cleanup_campaign_operational_data(
  p_event_retention_days integer default 90,
  p_sync_retention_days integer default 30,
  p_batch_size integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare deleted_events integer; deleted_syncs integer;
begin
  if p_event_retention_days not between 7 and 3650 or p_sync_retention_days not between 7 and 3650 or p_batch_size not between 100 and 20000 then
    raise exception 'Política de retenção inválida.' using errcode = '22023';
  end if;
  with doomed as (select id from public.campaign_redirect_events where created_at < now() - make_interval(days => p_event_retention_days) order by created_at limit p_batch_size),
  removed as (delete from public.campaign_redirect_events e using doomed d where e.id = d.id returning 1)
  select count(*) into deleted_events from removed;
  with doomed as (select id from public.group_participant_syncs where created_at < now() - make_interval(days => p_sync_retention_days) order by created_at limit p_batch_size),
  removed as (delete from public.group_participant_syncs s using doomed d where s.id = d.id returning 1)
  select count(*) into deleted_syncs from removed;
  delete from public.rate_limits where expires_at < now();
  return jsonb_build_object('deleted_events', deleted_events, 'deleted_syncs', deleted_syncs);
end;
$$;

-- Harden legacy SECURITY DEFINER functions without changing their signatures.
alter function public.create_envio_from_webhook(text, text, text, text, text, text, text, text, text, text, text)
  set search_path to pg_catalog, public;

-- Every privileged RPC is server-only. RLS alone does not protect SECURITY DEFINER functions.
revoke all on function public.acquire_service_lock(text, text, integer) from public, anon, authenticated;
revoke all on function public.renew_service_lock(text, text) from public, anon, authenticated;
revoke all on function public.increment_rate_limit(text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_next_envio() from public, anon, authenticated;
revoke all on function public.claim_next_envio_grupo() from public, anon, authenticated;
revoke all on function public.clear_whatsapp_auth(text) from public, anon, authenticated;
revoke all on function public.create_envio_from_webhook(text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.recalc_lote_counts(uuid) from public, anon, authenticated;
revoke all on function public.create_campaign_atomic(text, text[], uuid) from public, anon, authenticated;
revoke all on function public.replace_campaign_groups_atomic(uuid, text[]) from public, anon, authenticated;
revoke all on function public.create_group_lote_atomic(text, uuid, text[], uuid, text, text, text, boolean, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.transition_lote_atomic(uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_campaign_redirect(text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.get_campaign_redirect_metrics(uuid) from public, anon, authenticated;
revoke all on function public.cleanup_campaign_operational_data(integer, integer, integer) from public, anon, authenticated;

grant execute on function public.acquire_service_lock(text, text, integer) to service_role;
grant execute on function public.renew_service_lock(text, text) to service_role;
grant execute on function public.increment_rate_limit(text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.claim_next_envio() to service_role;
grant execute on function public.claim_next_envio_grupo() to service_role;
grant execute on function public.clear_whatsapp_auth(text) to service_role;
grant execute on function public.create_envio_from_webhook(text, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.recalc_lote_counts(uuid) to service_role;
grant execute on function public.create_campaign_atomic(text, text[], uuid) to service_role;
grant execute on function public.replace_campaign_groups_atomic(uuid, text[]) to service_role;
grant execute on function public.create_group_lote_atomic(text, uuid, text[], uuid, text, text, text, boolean, timestamptz, jsonb) to service_role;
grant execute on function public.transition_lote_atomic(uuid, text) to service_role;
grant execute on function public.resolve_campaign_redirect(text, jsonb, text, text, text) to service_role;
grant execute on function public.get_campaign_redirect_metrics(uuid) to service_role;
grant execute on function public.cleanup_campaign_operational_data(integer, integer, integer) to service_role;

notify pgrst, 'reload schema';
commit;
