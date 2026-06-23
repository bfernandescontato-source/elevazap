create extension if not exists pgcrypto;

create table if not exists service_lock (
  id text primary key,
  instance_id text,
  heartbeat timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists whatsapp_auth_creds (
  session_name text primary key,
  creds jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists whatsapp_auth_keys (
  session_name text not null,
  key_type text not null,
  key_id text not null,
  key_data jsonb not null,
  updated_at timestamptz default now(),
  primary key(session_name, key_type, key_id)
);

create table if not exists config (
  id uuid primary key default gen_random_uuid(),
  welcome_message text not null default 'Olá {{nome}}, sua compra foi aprovada. Bem-vindo(a)!',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists envios (
  id uuid primary key default gen_random_uuid(),
  source text,
  event text,
  idempotency_key text unique,
  order_id text,
  transaction_id text,
  nome text,
  telefone text,
  telefone_mascarado text,
  produto text,
  email text,
  mensagem_enviada text,
  status text check (status in ('pendente','enfileirado','processando','sucesso','erro','pausado','incerto')) default 'pendente',
  claim_token uuid,
  erro text,
  attempts int default 0,
  scheduled_at timestamptz default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  sent_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  wa_message_id text,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists grupos (
  id uuid primary key default gen_random_uuid(),
  group_jid text unique not null,
  nome text,
  qtd_membros int,
  sou_admin boolean,
  foto_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists envios_grupo_lotes (
  id uuid primary key default gen_random_uuid(),
  titulo text,
  tipo text check (tipo in ('texto','imagem','video','audio','audio_voz','documento')),
  texto text,
  legenda text,
  mention_all boolean not null default false,
  media_bucket text,
  media_path text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  status text check (status in ('pendente','processando','sucesso','erro','pausado','cancelado','incerto')) default 'pendente',
  total int default 0,
  enviados int default 0,
  erros int default 0,
  pendentes int default 0,
  enfileirados int default 0,
  processando int default 0,
  incertos int default 0,
  scheduled_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists envios_grupo (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid references envios_grupo_lotes(id) on delete cascade,
  group_jid text not null,
  nome_grupo text,
  tipo text,
  texto text,
  legenda text,
  mention_all boolean not null default false,
  media_bucket text,
  media_path text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  status text check (status in ('pendente','enfileirado','processando','sucesso','erro','pausado','cancelado','incerto')) default 'pendente',
  claim_token uuid,
  erro text,
  attempts int default 0,
  scheduled_at timestamptz default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  sent_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  wa_message_id text,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists opt_outs (
  id uuid primary key default gen_random_uuid(),
  telefone text,
  email text,
  motivo text,
  created_at timestamptz default now(),
  created_by text
);

create table if not exists rate_limits (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  scope text not null,
  count int not null default 0,
  window_start timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(key, scope, window_start)
);

create index if not exists envios_order_id_idx on envios(order_id);
create index if not exists envios_transaction_id_idx on envios(transaction_id);
create index if not exists envios_status_idx on envios(status);
create index if not exists envios_scheduled_at_idx on envios(scheduled_at);
create index if not exists envios_next_attempt_at_idx on envios(next_attempt_at);
create index if not exists envios_claimed_at_idx on envios(claimed_at);
create index if not exists envios_telefone_idx on envios(telefone);
create index if not exists envios_created_at_idx on envios(created_at);
create index if not exists grupos_group_jid_idx on grupos(group_jid);
create index if not exists envios_grupo_lote_id_idx on envios_grupo(lote_id);
create index if not exists envios_grupo_group_jid_idx on envios_grupo(group_jid);
create index if not exists envios_grupo_status_idx on envios_grupo(status);
create index if not exists envios_grupo_scheduled_at_idx on envios_grupo(scheduled_at);
create index if not exists envios_grupo_next_attempt_at_idx on envios_grupo(next_attempt_at);
create index if not exists envios_grupo_claimed_at_idx on envios_grupo(claimed_at);
create index if not exists service_lock_heartbeat_idx on service_lock(heartbeat);
create index if not exists rate_limits_key_scope_window_idx on rate_limits(key, scope, window_start);

alter table service_lock enable row level security;
alter table whatsapp_auth_creds enable row level security;
alter table whatsapp_auth_keys enable row level security;
alter table config enable row level security;
alter table envios enable row level security;
alter table grupos enable row level security;
alter table envios_grupo_lotes enable row level security;
alter table envios_grupo enable row level security;
alter table opt_outs enable row level security;
alter table rate_limits enable row level security;

create or replace function acquire_service_lock(p_id text, p_instance_id text, p_ttl_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare acquired boolean;
begin
  insert into service_lock(id, instance_id, heartbeat, created_at, updated_at)
  values (p_id, p_instance_id, now(), now(), now())
  on conflict (id) do update
  set instance_id = excluded.instance_id,
      heartbeat = now(),
      updated_at = now()
  where service_lock.heartbeat < now() - make_interval(secs => p_ttl_seconds)
     or service_lock.instance_id = p_instance_id;

  select instance_id = p_instance_id into acquired from service_lock where id = p_id;
  return coalesce(acquired, false);
end;
$$;

create or replace function renew_service_lock(p_id text, p_instance_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update service_lock
  set heartbeat = now(), updated_at = now()
  where id = p_id and instance_id = p_instance_id;
  return found;
end;
$$;

create or replace function increment_rate_limit(p_key text, p_scope text, p_window_start timestamptz, p_expires_at timestamptz)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare current_count int;
begin
  delete from rate_limits where expires_at < now();
  insert into rate_limits(key, scope, count, window_start, expires_at, created_at, updated_at)
  values (p_key, p_scope, 1, p_window_start, p_expires_at, now(), now())
  on conflict(key, scope, window_start) do update
  set count = rate_limits.count + 1, updated_at = now()
  returning count into current_count;
  return current_count;
end;
$$;

create or replace function claim_next_envio()
returns envios
language plpgsql
security definer
set search_path = public
as $$
declare job envios;
begin
  select * into job
  from envios
  where status = 'pendente'
    and scheduled_at <= now()
    and (next_attempt_at is null or next_attempt_at <= now())
  order by scheduled_at asc, created_at asc
  for update skip locked
  limit 1;

  if not found then return null; end if;

  update envios
  set status = 'enfileirado',
      claimed_at = now(),
      claim_token = gen_random_uuid(),
      updated_at = now()
  where id = job.id
  returning * into job;

  return job;
end;
$$;

create or replace function claim_next_envio_grupo()
returns envios_grupo
language plpgsql
security definer
set search_path = public
as $$
declare job envios_grupo;
begin
  select * into job
  from envios_grupo
  where status = 'pendente'
    and scheduled_at <= now()
    and (next_attempt_at is null or next_attempt_at <= now())
  order by scheduled_at asc, created_at asc
  for update skip locked
  limit 1;

  if not found then return null; end if;

  update envios_grupo
  set status = 'enfileirado',
      claimed_at = now(),
      claim_token = gen_random_uuid(),
      updated_at = now()
  where id = job.id
  returning * into job;

  update envios_grupo_lotes
  set status = 'processando',
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = job.lote_id and status in ('pendente','processando');

  perform recalc_lote_counts(job.lote_id);
  return job;
end;
$$;

create or replace function create_envio_from_webhook(
  p_source text,
  p_event text,
  p_idempotency_key text,
  p_order_id text,
  p_transaction_id text,
  p_nome text,
  p_telefone text,
  p_telefone_mascarado text,
  p_produto text,
  p_email text,
  p_mensagem_enviada text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare inserted_id uuid;
begin
  insert into envios(source, event, idempotency_key, order_id, transaction_id, nome, telefone, telefone_mascarado, produto, email, mensagem_enviada, status)
  values (p_source, p_event, p_idempotency_key, p_order_id, p_transaction_id, p_nome, p_telefone, p_telefone_mascarado, p_produto, p_email, p_mensagem_enviada, 'pendente')
  on conflict (idempotency_key) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    return jsonb_build_object('ok', true, 'duplicado', true);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function recalc_lote_counts(p_lote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c record;
begin
  select
    count(*)::int as total,
    count(*) filter (where status = 'sucesso')::int as enviados,
    count(*) filter (where status = 'erro')::int as erros,
    count(*) filter (where status = 'pendente')::int as pendentes,
    count(*) filter (where status = 'enfileirado')::int as enfileirados,
    count(*) filter (where status = 'processando')::int as processando,
    count(*) filter (where status = 'incerto')::int as incertos
  into c
  from envios_grupo
  where lote_id = p_lote_id;

  update envios_grupo_lotes
  set total = c.total,
      enviados = c.enviados,
      erros = c.erros,
      pendentes = c.pendentes,
      enfileirados = c.enfileirados,
      processando = c.processando,
      incertos = c.incertos,
      status = case
        when c.incertos > 0 then 'incerto'
        when c.processando > 0 or c.enfileirados > 0 then 'processando'
        when c.pendentes > 0 then 'pendente'
        when c.erros > 0 and c.enviados = 0 then 'erro'
        when c.total > 0 and c.enviados + c.erros = c.total then 'sucesso'
        else status
      end,
      finished_at = case when c.total > 0 and c.enviados + c.erros = c.total then coalesce(finished_at, now()) else finished_at end,
      updated_at = now()
  where id = p_lote_id;
end;
$$;
