-- Torna os disparos oficiais seguros para concorrência e falhas de funções serverless.
-- O banco reserva um único lote por disparo. Se uma função morrer depois de chamar a Meta,
-- o contato fica como falha de entrega incerta e não é reenviado automaticamente.

alter table public.official_broadcasts
  add column if not exists worker_lease_token text,
  add column if not exists worker_lease_until timestamptz;

alter table public.official_broadcast_recipients
  add column if not exists attempt_count integer not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists lease_token text,
  add column if not exists lease_expires_at timestamptz;

create index if not exists official_broadcasts_recovery_idx
  on public.official_broadcasts (last_batch_at)
  where status = 'processing';

create or replace function public.protect_pending_official_broadcast_flow() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.official_broadcasts b
    where b.flow_id = old.id and b.status in ('scheduled', 'processing', 'paused')
  ) then
    raise exception 'Este fluxo possui um disparo agendado ou em andamento.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_pending_official_broadcast_flow_trigger on public.official_flows;
create trigger protect_pending_official_broadcast_flow_trigger
before update of initial_template_name, initial_template_language, variable_mapping, quick_reply_action_id, active
on public.official_flows
for each row
when (
  old.initial_template_name is distinct from new.initial_template_name
  or old.initial_template_language is distinct from new.initial_template_language
  or old.variable_mapping is distinct from new.variable_mapping
  or old.quick_reply_action_id is distinct from new.quick_reply_action_id
  or old.active is distinct from new.active
)
execute function public.protect_pending_official_broadcast_flow();

create or replace function public.create_official_broadcast_with_recipients(
  p_name text,
  p_flow_id uuid,
  p_connection_id uuid,
  p_status text,
  p_scheduled_at timestamptz,
  p_delivery_speed text,
  p_dispatch_concurrency integer,
  p_recipients jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_broadcast_id uuid;
  v_recipient_count integer;
begin
  if p_status not in ('scheduled', 'processing') then
    raise exception 'Status inicial de disparo inválido.';
  end if;
  if jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) = 0 then
    raise exception 'O disparo precisa ter destinatários.';
  end if;

  v_recipient_count := jsonb_array_length(p_recipients);
  insert into public.official_broadcasts (
    name, flow_id, connection_id, status, scheduled_at, total_rows, valid_recipients,
    delivery_speed, dispatch_concurrency, skip_recipients_with_prior_run, started_at, last_batch_at
  ) values (
    p_name, p_flow_id, p_connection_id, p_status, p_scheduled_at, v_recipient_count,
    v_recipient_count, p_delivery_speed, p_dispatch_concurrency, false,
    case when p_status = 'processing' then clock_timestamp() else null end,
    case when p_status = 'processing' then clock_timestamp() else null end
  ) returning id into v_broadcast_id;

  insert into public.official_broadcast_recipients (broadcast_id, phone, row_data, status)
  select v_broadcast_id, item->>'phone', coalesce(item->'row_data', '{}'::jsonb), 'queued'
  from jsonb_array_elements(p_recipients) item;

  return v_broadcast_id;
end;
$$;

create or replace function public.claim_due_official_broadcasts(
  p_limit integer default 20,
  p_stale_seconds integer default 45
) returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  with candidates as (
    select b.id
    from public.official_broadcasts b
    where (b.status = 'scheduled' and b.scheduled_at <= clock_timestamp())
       or (b.status = 'processing'
           and (b.worker_lease_until is null or b.worker_lease_until < clock_timestamp())
           and (b.last_batch_at is null or b.last_batch_at < clock_timestamp() - make_interval(secs => p_stale_seconds)))
    order by coalesce(b.scheduled_at, b.last_batch_at, b.created_at)
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.official_broadcasts b
  set status = 'processing',
      started_at = coalesce(b.started_at, clock_timestamp()),
      last_batch_at = clock_timestamp()
  from candidates c
  where b.id = c.id
  returning b.id;
end;
$$;

create or replace function public.claim_official_broadcast_batch(
  p_broadcast_id uuid,
  p_worker_token text,
  p_limit integer,
  p_lease_seconds integer default 300
) returns setof public.official_broadcast_recipients
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_broadcast public.official_broadcasts%rowtype;
begin
  select * into v_broadcast
  from public.official_broadcasts
  where id = p_broadcast_id
  for update;

  if not found or v_broadcast.status <> 'processing' then return; end if;
  if v_broadcast.worker_lease_until is not null
     and v_broadcast.worker_lease_until >= clock_timestamp() then return; end if;

  -- Uma tentativa interrompida é ambígua: a Meta pode ter aceitado a mensagem antes da queda.
  -- Falhar sem reenviar é a única escolha que preserva a garantia de não duplicidade.
  update public.official_broadcast_recipients r
  set status = 'failed',
      error = 'UNCERTAIN_DELIVERY: processamento interrompido; não reenviado para evitar duplicidade.',
      failed_at = coalesce(r.failed_at, clock_timestamp()),
      lease_token = null,
      lease_expires_at = null
  where r.broadcast_id = p_broadcast_id
    and r.status = 'processing'
    and (r.lease_expires_at is null or r.lease_expires_at < clock_timestamp());

  update public.official_broadcasts
  set worker_lease_token = p_worker_token,
      worker_lease_until = clock_timestamp() + make_interval(secs => least(greatest(p_lease_seconds, 30), 900)),
      last_batch_at = clock_timestamp()
  where id = p_broadcast_id;

  return query
  with candidates as (
    select r.id
    from public.official_broadcast_recipients r
    where r.broadcast_id = p_broadcast_id and r.status = 'queued'
    order by r.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 60)
  )
  update public.official_broadcast_recipients r
  set status = 'processing',
      attempt_count = r.attempt_count + 1,
      processing_started_at = clock_timestamp(),
      lease_token = p_worker_token,
      lease_expires_at = clock_timestamp() + make_interval(secs => least(greatest(p_lease_seconds, 30), 900))
  from candidates c
  where r.id = c.id
  returning r.*;
end;
$$;

create or replace function public.finish_official_broadcast_batch(
  p_broadcast_id uuid,
  p_worker_token text,
  p_pause boolean default false
) returns table (has_more boolean, completed boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_queued integer;
  v_processing integer;
  v_accepted integer;
  v_failed integer;
  v_status text;
begin
  select b.status into v_status
  from public.official_broadcasts b
  where b.id = p_broadcast_id and b.worker_lease_token = p_worker_token
  for update;
  if not found then return; end if;

  select
    count(*) filter (where r.status = 'queued'),
    count(*) filter (where r.status = 'processing'),
    count(*) filter (where r.status in ('accepted', 'sent', 'delivered', 'read')),
    count(*) filter (where r.status = 'failed')
  into v_queued, v_processing, v_accepted, v_failed
  from public.official_broadcast_recipients r
  where r.broadcast_id = p_broadcast_id;

  update public.official_broadcasts
  set processed = v_accepted + v_failed,
      accepted = v_accepted,
      failed = v_failed,
      status = case
        when p_pause then 'paused'
        when v_queued = 0 and v_processing = 0 then 'completed'
        else v_status
      end,
      completed_at = case when not p_pause and v_queued = 0 and v_processing = 0 then clock_timestamp() else completed_at end,
      worker_lease_token = null,
      worker_lease_until = null,
      last_batch_at = clock_timestamp()
  where id = p_broadcast_id;

  return query select (v_queued > 0 and not p_pause), (v_queued = 0 and v_processing = 0 and not p_pause);
end;
$$;

revoke all on function public.create_official_broadcast_with_recipients(text,uuid,uuid,text,timestamptz,text,integer,jsonb) from public, anon, authenticated;
revoke all on function public.claim_due_official_broadcasts(integer,integer) from public, anon, authenticated;
revoke all on function public.claim_official_broadcast_batch(uuid,text,integer,integer) from public, anon, authenticated;
revoke all on function public.finish_official_broadcast_batch(uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.protect_pending_official_broadcast_flow() from public, anon, authenticated;
grant execute on function public.create_official_broadcast_with_recipients(text,uuid,uuid,text,timestamptz,text,integer,jsonb) to service_role;
grant execute on function public.claim_due_official_broadcasts(integer,integer) to service_role;
grant execute on function public.claim_official_broadcast_batch(uuid,text,integer,integer) to service_role;
grant execute on function public.finish_official_broadcast_batch(uuid,text,boolean) to service_role;
