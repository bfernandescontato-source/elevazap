-- Relay assíncrono Meta -> ElevaPay CRM. Não participa do caminho de resposta da Meta.
create table if not exists public.meta_relay_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  phone_number_id text not null,
  event_types text[] not null default '{}',
  event_ids text[] not null default '{}',
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'retry_scheduled', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 5),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_http_status integer,
  last_error text,
  last_duration_ms integer,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_relay_jobs_due_idx
  on public.meta_relay_jobs(next_attempt_at)
  where status in ('queued', 'retry_scheduled');
create index if not exists meta_relay_jobs_phone_created_idx
  on public.meta_relay_jobs(phone_number_id, created_at desc);

alter table public.meta_relay_jobs enable row level security;
revoke all on public.meta_relay_jobs from anon, authenticated;
grant select, insert, update on public.meta_relay_jobs to service_role;

create or replace function public.claim_due_meta_relay_jobs(
  p_limit integer default 20,
  p_stale_seconds integer default 120
) returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Uma requisição interrompida é retentável: o CRM recebe X-Disparei-Relay-Idempotency-Key
  -- e deve tratá-la como idempotente. A prioridade é nunca bloquear a resposta da Meta.
  update public.meta_relay_jobs
  set status = 'retry_scheduled',
      claimed_at = null,
      next_attempt_at = clock_timestamp(),
      last_error = coalesce(last_error, 'Tentativa interrompida; reprogramada.'),
      updated_at = clock_timestamp()
  where status = 'processing'
    and claimed_at < clock_timestamp() - make_interval(secs => p_stale_seconds);

  return query
  with candidates as (
    select j.id
    from public.meta_relay_jobs j
    where j.status in ('queued', 'retry_scheduled')
      and j.next_attempt_at <= clock_timestamp()
    order by j.next_attempt_at, j.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.meta_relay_jobs j
  set status = 'processing', claimed_at = clock_timestamp(), updated_at = clock_timestamp()
  from candidates c
  where j.id = c.id
  returning j.id;
end;
$$;

revoke all on function public.claim_due_meta_relay_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_due_meta_relay_jobs(integer, integer) to service_role;
