begin;

-- Persistent operational boundary: backlog is retained for audit, but never
-- becomes eligible again after a worker restart or deployment.
create table if not exists public.queue_control (
  key text primary key check (key = 'whatsapp_dispatch'),
  queue_reset_at timestamptz not null,
  dispatch_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.queue_control enable row level security;
revoke all on table public.queue_control from anon, authenticated;

insert into public.queue_control(key, queue_reset_at, dispatch_enabled, updated_at)
values ('whatsapp_dispatch', now(), false, now())
on conflict (key) do update set queue_reset_at=excluded.queue_reset_at,
  dispatch_enabled=false, updated_at=now();

update public.envios e set status='cancelado', claim_token=null,
  processing_deadline_at=null, reconciliation_required=false,
  erro=coalesce(e.erro, 'Cancelado pelo reset operacional da fila.'),
  last_error_code='QUEUE_OPERATIONAL_RESET', updated_at=now()
from public.queue_control c
where c.key='whatsapp_dispatch'
  and e.status in ('pendente','enfileirado','processando','pausado','incerto')
  and (e.created_at <= c.queue_reset_at or e.scheduled_at <= c.queue_reset_at);

update public.envios_grupo e set status='cancelado', claim_token=null,
  processing_deadline_at=null, reconciliation_required=false,
  erro=coalesce(e.erro, 'Cancelado pelo reset operacional da fila.'),
  last_error_code='QUEUE_OPERATIONAL_RESET', updated_at=now()
from public.queue_control c
where c.key='whatsapp_dispatch'
  and e.status in ('pendente','enfileirado','processando','pausado','incerto')
  and (e.created_at <= c.queue_reset_at or e.scheduled_at <= c.queue_reset_at);

-- Legacy workers are fenced too. Their only eligible work is created and
-- scheduled after the marker, and only after an explicit enable operation.
create or replace function public.claim_next_envio() returns public.envios
language plpgsql security definer set search_path = pg_catalog, public as $$
declare job public.envios;
begin
  select e.* into job from public.envios e
  join public.accounts a on a.id=e.account_id and a.status='active'
  join public.whatsapp_senders s on s.id=e.whatsapp_session_id and s.account_id=e.account_id
  cross join public.queue_control c
  where c.key='whatsapp_dispatch' and c.dispatch_enabled and e.status='pendente'
    and e.created_at>c.queue_reset_at and e.scheduled_at>c.queue_reset_at and e.scheduled_at<=now()
    and (e.next_attempt_at is null or e.next_attempt_at<=now())
  order by e.scheduled_at,e.created_at for update of e skip locked limit 1;
  if not found then return null; end if;
  update public.envios set status='enfileirado',claimed_at=now(),claim_token=gen_random_uuid(),updated_at=now()
  where id=job.id and status='pendente' returning * into job;
  return job;
end $$;

create or replace function public.claim_next_envio_grupo() returns public.envios_grupo
language plpgsql security definer set search_path = pg_catalog, public as $$
declare job public.envios_grupo;
begin
  select e.* into job from public.envios_grupo e
  join public.accounts a on a.id=e.account_id and a.status='active'
  join public.whatsapp_senders s on s.id=e.whatsapp_session_id and s.account_id=e.account_id
  cross join public.queue_control c
  where c.key='whatsapp_dispatch' and c.dispatch_enabled and e.status='pendente'
    and e.created_at>c.queue_reset_at and e.scheduled_at>c.queue_reset_at and e.scheduled_at<=now()
    and (e.next_attempt_at is null or e.next_attempt_at<=now())
  order by e.scheduled_at,e.created_at for update of e skip locked limit 1;
  if not found then return null; end if;
  update public.envios_grupo set status='enfileirado',claimed_at=now(),claim_token=gen_random_uuid(),updated_at=now()
  where id=job.id and status='pendente' returning * into job;
  update public.envios_grupo_lotes set status='processando',started_at=coalesce(started_at,now()),updated_at=now()
  where id=job.lote_id and account_id=job.account_id and status in ('pendente','processando');
  perform public.recalc_lote_counts(job.lote_id);
  return job;
end $$;

revoke all on function public.claim_next_envio() from public,anon,authenticated;
revoke all on function public.claim_next_envio_grupo() from public,anon,authenticated;
grant execute on function public.claim_next_envio() to service_role;
grant execute on function public.claim_next_envio_grupo() to service_role;

commit;
