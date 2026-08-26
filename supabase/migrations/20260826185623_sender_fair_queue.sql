begin;

-- Canonical, immutable queue ownership key. whatsapp_sender_id remains during the
-- compatibility window because older web deployments still write that column.
alter table public.envios add column if not exists whatsapp_session_id uuid references public.whatsapp_senders(id) on delete set null;
alter table public.envios_grupo add column if not exists whatsapp_session_id uuid references public.whatsapp_senders(id) on delete set null;
alter table public.envios_grupo_lotes add column if not exists whatsapp_session_id uuid references public.whatsapp_senders(id) on delete set null;

update public.envios set whatsapp_session_id = whatsapp_sender_id
where whatsapp_session_id is null and whatsapp_sender_id is not null;
update public.envios_grupo set whatsapp_session_id = whatsapp_sender_id
where whatsapp_session_id is null and whatsapp_sender_id is not null;
update public.envios_grupo_lotes set whatsapp_session_id = whatsapp_sender_id
where whatsapp_session_id is null and whatsapp_sender_id is not null;

create or replace function public.sync_whatsapp_session_id() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.whatsapp_session_id is null then new.whatsapp_session_id := new.whatsapp_sender_id; end if;
  if new.whatsapp_sender_id is null then new.whatsapp_sender_id := new.whatsapp_session_id; end if;
  if new.whatsapp_session_id is distinct from new.whatsapp_sender_id then
    raise exception 'whatsapp_session_id e whatsapp_sender_id divergentes' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists sync_envios_whatsapp_session_id on public.envios;
create trigger sync_envios_whatsapp_session_id before insert or update of whatsapp_session_id, whatsapp_sender_id
on public.envios for each row execute function public.sync_whatsapp_session_id();
drop trigger if exists sync_envios_grupo_whatsapp_session_id on public.envios_grupo;
create trigger sync_envios_grupo_whatsapp_session_id before insert or update of whatsapp_session_id, whatsapp_sender_id
on public.envios_grupo for each row execute function public.sync_whatsapp_session_id();
drop trigger if exists sync_envios_grupo_lotes_whatsapp_session_id on public.envios_grupo_lotes;
create trigger sync_envios_grupo_lotes_whatsapp_session_id before insert or update of whatsapp_session_id, whatsapp_sender_id
on public.envios_grupo_lotes for each row execute function public.sync_whatsapp_session_id();

alter table public.envios drop constraint if exists envios_active_job_requires_session_id;
alter table public.envios add constraint envios_active_job_requires_session_id
check (status not in ('pendente','enfileirado','processando') or whatsapp_session_id is not null) not valid;
alter table public.envios_grupo drop constraint if exists envios_grupo_active_job_requires_session_id;
alter table public.envios_grupo add constraint envios_grupo_active_job_requires_session_id
check (status not in ('pendente','enfileirado','processando') or whatsapp_session_id is not null) not valid;

alter table public.envios add column if not exists processing_lease_version bigint;
alter table public.envios add column if not exists processing_worker_id text;
alter table public.envios add column if not exists processing_deadline_at timestamptz;
alter table public.envios add column if not exists reconciliation_required boolean not null default false;
alter table public.envios add column if not exists last_error_code text;
alter table public.envios_grupo add column if not exists processing_lease_version bigint;
alter table public.envios_grupo add column if not exists processing_worker_id text;
alter table public.envios_grupo add column if not exists processing_deadline_at timestamptz;
alter table public.envios_grupo add column if not exists reconciliation_required boolean not null default false;
alter table public.envios_grupo add column if not exists last_error_code text;

alter table public.envios_grupo add column if not exists idempotency_key text;
update public.envios_grupo set idempotency_key = id::text where idempotency_key is null;
alter table public.envios_grupo alter column idempotency_key set default gen_random_uuid()::text;
alter table public.envios_grupo alter column idempotency_key set not null;
create unique index if not exists envios_grupo_account_idempotency_idx
  on public.envios_grupo(account_id, idempotency_key);

alter table public.whatsapp_senders
  add column if not exists connection_status text not null default 'disconnected',
  add column if not exists connection_heartbeat_at timestamptz,
  add column if not exists last_queue_claimed_at timestamptz,
  add column if not exists last_message_sent_at timestamptz,
  add column if not exists circuit_state text not null default 'closed',
  add column if not exists circuit_open_until timestamptz,
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists last_connection_error text;

alter table public.whatsapp_senders drop constraint if exists whatsapp_senders_connection_status_check;
alter table public.whatsapp_senders add constraint whatsapp_senders_connection_status_check
  check (connection_status in ('disconnected','starting','waiting_qr','connected','reconnecting','logged_out','failed'));
alter table public.whatsapp_senders drop constraint if exists whatsapp_senders_circuit_state_check;
alter table public.whatsapp_senders add constraint whatsapp_senders_circuit_state_check
  check (circuit_state in ('closed','open','half_open'));

create table if not exists public.whatsapp_session_leases (
  whatsapp_session_id uuid primary key references public.whatsapp_senders(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  owner_worker_id text not null,
  lease_expires_at timestamptz not null,
  lease_version bigint not null default 1 check (lease_version > 0),
  acquired_at timestamptz not null default now(),
  renewed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, whatsapp_session_id)
);
alter table public.whatsapp_session_leases enable row level security;

create index if not exists whatsapp_session_leases_expiry_idx
  on public.whatsapp_session_leases(lease_expires_at, whatsapp_session_id);
create index if not exists whatsapp_session_leases_owner_idx
  on public.whatsapp_session_leases(owner_worker_id, lease_expires_at);
create index if not exists envios_sender_due_idx
  on public.envios(whatsapp_session_id, scheduled_at, created_at)
  where status = 'pendente';
create index if not exists envios_grupo_sender_due_idx
  on public.envios_grupo(whatsapp_session_id, scheduled_at, created_at)
  where status = 'pendente';
create index if not exists envios_account_active_idx
  on public.envios(account_id, status, processing_deadline_at)
  where status in ('enfileirado','processando');
create index if not exists envios_grupo_account_active_idx
  on public.envios_grupo(account_id, status, processing_deadline_at)
  where status in ('enfileirado','processando');
create index if not exists whatsapp_senders_dispatch_idx
  on public.whatsapp_senders(connection_status, circuit_open_until, last_queue_claimed_at);

create or replace function public.acquire_whatsapp_session_leases(
  p_worker_id text,
  p_limit integer,
  p_ttl_seconds integer
) returns table(whatsapp_session_id uuid, account_id uuid, lease_version bigint)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare candidate record; owned_count integer; new_version bigint;
begin
  if nullif(trim(p_worker_id),'') is null or p_limit not between 1 and 1000 or p_ttl_seconds not between 15 and 300 then
    raise exception 'Parâmetros de lease inválidos.' using errcode = '22023';
  end if;

  select count(*) into owned_count from public.whatsapp_session_leases l
  where l.owner_worker_id=p_worker_id and l.lease_expires_at>now();

  for candidate in
    select s.id, s.account_id
    from public.whatsapp_senders s
    join public.accounts a on a.id=s.account_id and a.status='active'
    left join public.whatsapp_session_leases l on l.whatsapp_session_id=s.id
    where l.whatsapp_session_id is null or l.owner_worker_id=p_worker_id or l.lease_expires_at<=now()
    order by (l.owner_worker_id=p_worker_id) desc nulls last, l.lease_expires_at nulls first, s.created_at
    for update of s skip locked
    limit greatest(0,p_limit-owned_count)
  loop
    insert into public.whatsapp_session_leases as l
      (whatsapp_session_id,account_id,owner_worker_id,lease_expires_at,lease_version,acquired_at,renewed_at,updated_at)
    values (candidate.id,candidate.account_id,p_worker_id,now()+make_interval(secs=>p_ttl_seconds),1,now(),now(),now())
    on conflict(whatsapp_session_id) do update set
      account_id=excluded.account_id,
      owner_worker_id=excluded.owner_worker_id,
      lease_expires_at=excluded.lease_expires_at,
      lease_version=case when l.owner_worker_id=excluded.owner_worker_id and l.lease_expires_at>now()
        then l.lease_version else l.lease_version+1 end,
      acquired_at=case when l.owner_worker_id=excluded.owner_worker_id and l.lease_expires_at>now()
        then l.acquired_at else now() end,
      renewed_at=now(), updated_at=now()
    where l.owner_worker_id=p_worker_id or l.lease_expires_at<=now()
    returning l.lease_version into new_version;
    new_version:=null;
  end loop;

  return query select l.whatsapp_session_id,l.account_id,l.lease_version
  from public.whatsapp_session_leases l
  where l.owner_worker_id=p_worker_id and l.lease_expires_at>now()
  order by l.acquired_at limit p_limit;
end $$;

create or replace function public.renew_whatsapp_session_leases(
  p_worker_id text,
  p_leases jsonb,
  p_ttl_seconds integer
) returns table(whatsapp_session_id uuid, lease_version bigint)
language sql security definer set search_path = pg_catalog, public as $$
  with requested as (
    select (x->>'whatsapp_session_id')::uuid session_id,(x->>'lease_version')::bigint version
    from jsonb_array_elements(coalesce(p_leases,'[]'::jsonb)) x
  ), renewed as (
    update public.whatsapp_session_leases l set
      lease_expires_at=now()+make_interval(secs=>p_ttl_seconds),renewed_at=now(),updated_at=now()
    from requested r
    where p_ttl_seconds between 15 and 300 and l.whatsapp_session_id=r.session_id
      and l.owner_worker_id=p_worker_id and l.lease_version=r.version and l.lease_expires_at>now()
    returning l.whatsapp_session_id,l.lease_version
  ) select * from renewed
$$;

create or replace function public.acquire_whatsapp_session_lease(
  p_worker_id text,p_session_id uuid,p_ttl_seconds integer
) returns table(whatsapp_session_id uuid,account_id uuid,lease_version bigint)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare sender_account uuid; new_version bigint;
begin
  if nullif(trim(p_worker_id),'') is null or p_ttl_seconds not between 15 and 300 then
    raise exception 'Parâmetros de lease inválidos.' using errcode='22023';
  end if;
  select s.account_id into sender_account from public.whatsapp_senders s
    join public.accounts a on a.id=s.account_id and a.status='active'
    where s.id=p_session_id for update of s;
  if sender_account is null then return; end if;
  insert into public.whatsapp_session_leases as l
    (whatsapp_session_id,account_id,owner_worker_id,lease_expires_at,lease_version,acquired_at,renewed_at,updated_at)
  values (p_session_id,sender_account,p_worker_id,now()+make_interval(secs=>p_ttl_seconds),1,now(),now(),now())
  on conflict(whatsapp_session_id) do update set owner_worker_id=excluded.owner_worker_id,
    account_id=excluded.account_id,lease_expires_at=excluded.lease_expires_at,
    lease_version=case when l.owner_worker_id=excluded.owner_worker_id and l.lease_expires_at>now()
      then l.lease_version else l.lease_version+1 end,
    acquired_at=case when l.owner_worker_id=excluded.owner_worker_id and l.lease_expires_at>now()
      then l.acquired_at else now() end,renewed_at=now(),updated_at=now()
  where l.owner_worker_id=p_worker_id or l.lease_expires_at<=now()
  returning l.lease_version into new_version;
  if new_version is not null then
    whatsapp_session_id:=p_session_id;account_id:=sender_account;lease_version:=new_version;return next;
  end if;
end $$;

create or replace function public.release_whatsapp_session_leases(p_worker_id text) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare released integer;
begin
  update public.whatsapp_session_leases set lease_expires_at=now(),updated_at=now()
  where owner_worker_id=p_worker_id and lease_expires_at>now();
  get diagnostics released=row_count;
  return released;
end $$;

create or replace function public.set_whatsapp_session_runtime_status(
  p_worker_id text,p_session_id uuid,p_lease_version bigint,p_status text,p_error text default null
) returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare changed integer;
begin
  if p_status not in ('disconnected','starting','waiting_qr','connected','reconnecting','logged_out','failed') then
    raise exception 'Status inválido.' using errcode='22023';
  end if;
  update public.whatsapp_senders s set connection_status=p_status,connection_heartbeat_at=now(),
    last_connection_error=p_error,updated_at=now()
  from public.whatsapp_session_leases l
  where s.id=p_session_id and l.whatsapp_session_id=s.id and l.owner_worker_id=p_worker_id
    and l.lease_version=p_lease_version and l.lease_expires_at>now();
  get diagnostics changed=row_count;
  return changed=1;
end $$;

create or replace function public.validate_whatsapp_session_lease(
  p_worker_id text,p_session_id uuid,p_lease_version bigint
) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.whatsapp_session_leases l
    where l.whatsapp_session_id=p_session_id and l.owner_worker_id=p_worker_id
      and l.lease_version=p_lease_version and l.lease_expires_at>now())
$$;

create or replace function public.record_whatsapp_session_failure(
  p_worker_id text,p_session_id uuid,p_lease_version bigint,p_error text,
  p_threshold integer,p_cooldown_seconds integer
) returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare failures integer; changed integer;
begin
  if p_threshold not between 1 and 100 or p_cooldown_seconds not between 1 and 3600 then
    raise exception 'Parâmetros do circuit breaker inválidos.' using errcode='22023';
  end if;
  update public.whatsapp_senders s set consecutive_failures=s.consecutive_failures+1,
    last_connection_error=left(coalesce(p_error,'Falha no envio.'),1000),updated_at=now()
  from public.whatsapp_session_leases l
  where s.id=p_session_id and l.whatsapp_session_id=s.id and l.owner_worker_id=p_worker_id
    and l.lease_version=p_lease_version and l.lease_expires_at>now()
  returning s.consecutive_failures into failures;
  get diagnostics changed=row_count;
  if changed=1 and failures>=p_threshold then
    update public.whatsapp_senders set circuit_state='open',
      circuit_open_until=now()+make_interval(secs=>p_cooldown_seconds),updated_at=now()
    where id=p_session_id;
  end if;
  return changed=1;
end $$;

create or replace function public.claim_whatsapp_jobs(
  p_worker_id text,p_limit integer,p_account_concurrency integer,p_processing_seconds integer
) returns table(
  message_id uuid,queue_table text,account_id uuid,whatsapp_session_id uuid,
  claim_token uuid,lease_version bigint,priority text,attempt integer
) language plpgsql security definer set search_path = pg_catalog, public as $$
declare lane record; job record; token uuid; claimed integer:=0;
begin
  if nullif(trim(p_worker_id),'') is null or p_limit not between 1 and 500
     or p_account_concurrency not between 1 and 100 or p_processing_seconds not between 15 and 600 then
    raise exception 'Parâmetros de claim inválidos.' using errcode='22023';
  end if;

  for lane in
    select l.whatsapp_session_id,l.account_id,l.lease_version
    from public.whatsapp_session_leases l
    join public.whatsapp_senders s on s.id=l.whatsapp_session_id and s.account_id=l.account_id
    join public.accounts a on a.id=l.account_id and a.status='active'
    where l.owner_worker_id=p_worker_id and l.lease_expires_at>now()
      and s.connection_status='connected'
      and (s.connection_heartbeat_at is null or s.connection_heartbeat_at>now()-interval '2 minutes')
      and (s.circuit_state<>'open' or s.circuit_open_until is null or s.circuit_open_until<=now())
      and not exists(select 1 from public.envios e where e.whatsapp_session_id=s.id and e.status in ('enfileirado','processando'))
      and not exists(select 1 from public.envios_grupo g where g.whatsapp_session_id=s.id and g.status in ('enfileirado','processando'))
      and ((select count(*) from public.envios e where e.account_id=l.account_id and e.status in ('enfileirado','processando'))
         + (select count(*) from public.envios_grupo g where g.account_id=l.account_id and g.status in ('enfileirado','processando'))) < p_account_concurrency
    order by s.last_queue_claimed_at nulls first,s.id
    for update of l skip locked
    limit p_limit
  loop
    job:=null;
    select * into job from (
      select e.id,'envios'::text table_name,'alta'::text job_priority,e.scheduled_at,e.created_at,coalesce(e.attempts,0) attempts
      from public.envios e where e.account_id=lane.account_id and e.whatsapp_session_id=lane.whatsapp_session_id
        and e.status='pendente' and e.scheduled_at<=now() and (e.next_attempt_at is null or e.next_attempt_at<=now())
      union all
      select g.id,'envios_grupo','normal',g.scheduled_at,g.created_at,coalesce(g.attempts,0)
      from public.envios_grupo g where g.account_id=lane.account_id and g.whatsapp_session_id=lane.whatsapp_session_id
        and g.status='pendente' and g.scheduled_at<=now() and (g.next_attempt_at is null or g.next_attempt_at<=now())
    ) due order by case when job_priority='alta' then 0 else 1 end,scheduled_at,created_at limit 1;

    if found and job.id is not null then
      token:=gen_random_uuid();
      if job.table_name='envios' then
        update public.envios e set status='enfileirado',claimed_at=now(),claim_token=token,
          processing_deadline_at=now()+make_interval(secs=>p_processing_seconds),
          processing_worker_id=p_worker_id,processing_lease_version=lane.lease_version,updated_at=now()
        where e.id=job.id and e.status='pendente' and e.account_id=lane.account_id and e.whatsapp_session_id=lane.whatsapp_session_id;
      else
        update public.envios_grupo g set status='enfileirado',claimed_at=now(),claim_token=token,
          processing_deadline_at=now()+make_interval(secs=>p_processing_seconds),
          processing_worker_id=p_worker_id,processing_lease_version=lane.lease_version,updated_at=now()
        where g.id=job.id and g.status='pendente' and g.account_id=lane.account_id and g.whatsapp_session_id=lane.whatsapp_session_id;
        update public.envios_grupo_lotes set status='processando',started_at=coalesce(started_at,now()),updated_at=now()
        where id=(select lote_id from public.envios_grupo where id=job.id) and account_id=lane.account_id and status in ('pendente','processando');
      end if;
      update public.whatsapp_senders set last_queue_claimed_at=now(),updated_at=now() where id=lane.whatsapp_session_id;
      message_id:=job.id;queue_table:=job.table_name;account_id:=lane.account_id;
      whatsapp_session_id:=lane.whatsapp_session_id;claim_token:=token;lease_version:=lane.lease_version;
      priority:=job.job_priority;attempt:=job.attempts;return next;
      claimed:=claimed+1;
      exit when claimed>=p_limit;
    end if;
  end loop;
end $$;

create or replace function public.mark_whatsapp_job_sending(
  p_worker_id text,p_queue_table text,p_message_id uuid,p_claim_token uuid,p_lease_version bigint,p_processing_seconds integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  if p_queue_table='envios' then
    update public.envios e set status='processando',started_at=now(),processing_deadline_at=now()+make_interval(secs=>p_processing_seconds),updated_at=now()
    from public.whatsapp_session_leases l where e.id=p_message_id and e.claim_token=p_claim_token and e.status='enfileirado'
      and e.processing_worker_id=p_worker_id and e.processing_lease_version=p_lease_version
      and l.whatsapp_session_id=e.whatsapp_session_id and l.account_id=e.account_id and l.owner_worker_id=p_worker_id
      and l.lease_version=p_lease_version and l.lease_expires_at>now()
    returning to_jsonb(e.*) into result;
  elsif p_queue_table='envios_grupo' then
    update public.envios_grupo e set status='processando',started_at=now(),processing_deadline_at=now()+make_interval(secs=>p_processing_seconds),updated_at=now()
    from public.whatsapp_session_leases l where e.id=p_message_id and e.claim_token=p_claim_token and e.status='enfileirado'
      and e.processing_worker_id=p_worker_id and e.processing_lease_version=p_lease_version
      and l.whatsapp_session_id=e.whatsapp_session_id and l.account_id=e.account_id and l.owner_worker_id=p_worker_id
      and l.lease_version=p_lease_version and l.lease_expires_at>now()
    returning to_jsonb(e.*) into result;
  else raise exception 'Fila inválida.' using errcode='22023';
  end if;
  return result;
end $$;

create or replace function public.complete_whatsapp_job_sent(
  p_worker_id text,p_queue_table text,p_message_id uuid,p_claim_token uuid,p_lease_version bigint,p_wa_message_id text
) returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare changed integer; session_id uuid; sent_time timestamptz:=now();
begin
  if nullif(p_wa_message_id,'') is null then return false; end if;
  if p_queue_table='envios' then
    update public.envios e set status='sucesso',sent_at=sent_time,wa_message_id=p_wa_message_id,erro=null,claim_token=null,
      processing_deadline_at=null,reconciliation_required=false,last_error_code=null,updated_at=sent_time
    from public.whatsapp_session_leases l where e.id=p_message_id and e.claim_token=p_claim_token
      and e.processing_worker_id=p_worker_id and e.processing_lease_version=p_lease_version
      and l.whatsapp_session_id=e.whatsapp_session_id and l.owner_worker_id=p_worker_id
      and l.lease_version=p_lease_version and l.lease_expires_at>now()
    returning e.whatsapp_session_id into session_id;
  elsif p_queue_table='envios_grupo' then
    update public.envios_grupo e set status='sucesso',sent_at=sent_time,wa_message_id=p_wa_message_id,erro=null,claim_token=null,
      processing_deadline_at=null,reconciliation_required=false,last_error_code=null,updated_at=sent_time
    from public.whatsapp_session_leases l where e.id=p_message_id and e.claim_token=p_claim_token
      and e.processing_worker_id=p_worker_id and e.processing_lease_version=p_lease_version
      and l.whatsapp_session_id=e.whatsapp_session_id and l.owner_worker_id=p_worker_id
      and l.lease_version=p_lease_version and l.lease_expires_at>now()
    returning e.whatsapp_session_id into session_id;
  else raise exception 'Fila inválida.' using errcode='22023'; end if;
  get diagnostics changed=row_count;
  if changed=1 then update public.whatsapp_senders set last_message_sent_at=sent_time,consecutive_failures=0,
    circuit_state='closed',circuit_open_until=null,updated_at=sent_time where id=session_id; end if;
  return changed=1;
end $$;

-- Compatibility claims remain fair between accounts during rolling deployment.
create or replace function public.claim_next_envio_grupo() returns public.envios_grupo
language plpgsql security definer set search_path = pg_catalog, public as $$
declare job public.envios_grupo;
begin
  with ranked as (
    select e.id,e.account_id,e.scheduled_at,e.created_at,
      row_number() over(partition by e.account_id order by e.scheduled_at,e.created_at) rn,
      max(e.claimed_at) over(partition by e.account_id) account_last_claim
    from public.envios_grupo e join public.accounts a on a.id=e.account_id and a.status='active'
    where e.status='pendente' and e.scheduled_at<=now() and e.whatsapp_session_id is not null
      and (e.next_attempt_at is null or e.next_attempt_at<=now())
  ) select e.* into job from public.envios_grupo e join ranked r on r.id=e.id and r.rn=1
    order by r.account_last_claim nulls first,r.scheduled_at,r.created_at for update of e skip locked limit 1;
  if not found then return null; end if;
  update public.envios_grupo set status='enfileirado',claimed_at=now(),processing_deadline_at=now()+interval '2 minutes',
    claim_token=gen_random_uuid(),updated_at=now() where id=job.id returning * into job;
  update public.envios_grupo_lotes set status='processando',started_at=coalesce(started_at,now()),updated_at=now()
    where id=job.lote_id and account_id=job.account_id and status in ('pendente','processando');
  perform public.recalc_lote_counts(job.lote_id);
  return job;
end $$;

revoke all on table public.whatsapp_session_leases from anon, authenticated;
revoke all on function public.acquire_whatsapp_session_leases(text,integer,integer) from public,anon,authenticated;
revoke all on function public.acquire_whatsapp_session_lease(text,uuid,integer) from public,anon,authenticated;
revoke all on function public.renew_whatsapp_session_leases(text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.release_whatsapp_session_leases(text) from public,anon,authenticated;
revoke all on function public.set_whatsapp_session_runtime_status(text,uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function public.validate_whatsapp_session_lease(text,uuid,bigint) from public,anon,authenticated;
revoke all on function public.record_whatsapp_session_failure(text,uuid,bigint,text,integer,integer) from public,anon,authenticated;
revoke all on function public.claim_whatsapp_jobs(text,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.mark_whatsapp_job_sending(text,text,uuid,uuid,bigint,integer) from public,anon,authenticated;
revoke all on function public.complete_whatsapp_job_sent(text,text,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.acquire_whatsapp_session_leases(text,integer,integer) to service_role;
grant execute on function public.acquire_whatsapp_session_lease(text,uuid,integer) to service_role;
grant execute on function public.renew_whatsapp_session_leases(text,jsonb,integer) to service_role;
grant execute on function public.release_whatsapp_session_leases(text) to service_role;
grant execute on function public.set_whatsapp_session_runtime_status(text,uuid,bigint,text,text) to service_role;
grant execute on function public.validate_whatsapp_session_lease(text,uuid,bigint) to service_role;
grant execute on function public.record_whatsapp_session_failure(text,uuid,bigint,text,integer,integer) to service_role;
grant execute on function public.claim_whatsapp_jobs(text,integer,integer,integer) to service_role;
grant execute on function public.mark_whatsapp_job_sending(text,text,uuid,uuid,bigint,integer) to service_role;
grant execute on function public.complete_whatsapp_job_sent(text,text,uuid,uuid,bigint,text) to service_role;

commit;
