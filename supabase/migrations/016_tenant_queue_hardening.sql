begin;

-- New work can only enter the queue with an explicitly selected tenant-owned session.
-- NOT VALID preserves historical terminal rows while enforcing the rule on new writes.
alter table public.envios
  add constraint envios_active_job_requires_session
  check (status not in ('pendente','enfileirado','processando') or whatsapp_session_name is not null) not valid;
alter table public.envios_grupo
  add constraint envios_grupo_active_job_requires_session
  check (status not in ('pendente','enfileirado','processando') or whatsapp_session_name is not null) not valid;

create or replace function public.claim_next_envio() returns public.envios
language plpgsql security definer set search_path = pg_catalog, public as $$
declare job public.envios;
begin
  select e.* into job from public.envios e join public.accounts a on a.id=e.account_id
  join public.whatsapp_senders s on s.account_id=e.account_id and s.session_name=e.whatsapp_session_name
  where e.status='pendente' and a.status='active' and e.scheduled_at<=now()
    and e.whatsapp_session_name is not null
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
  join public.whatsapp_senders s on s.account_id=e.account_id and s.session_name=e.whatsapp_session_name
  where e.status='pendente' and a.status='active' and e.scheduled_at<=now()
    and e.whatsapp_session_name is not null
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

revoke all on function public.claim_next_envio() from public, anon, authenticated;
revoke all on function public.claim_next_envio_grupo() from public, anon, authenticated;
grant execute on function public.claim_next_envio() to service_role;
grant execute on function public.claim_next_envio_grupo() to service_role;

commit;

