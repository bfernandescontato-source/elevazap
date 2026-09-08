-- Allow up to five destinations from the same group batch to be claimed for a
-- WhatsApp session. A session never mixes batches and never mixes a 1:1 job
-- with group deliveries while work is in flight.
create or replace function public.claim_whatsapp_jobs(
  p_worker_id text,p_limit integer,p_account_concurrency integer,p_processing_seconds integer
) returns table(
  message_id uuid,queue_table text,account_id uuid,whatsapp_session_id uuid,
  claim_token uuid,lease_version bigint,priority text,attempt integer
) language plpgsql security definer set search_path = pg_catalog, public as $$
declare lane record; job record; token uuid; claimed integer:=0; active_group_batch uuid;
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
      and (select count(*) from public.envios_grupo g where g.whatsapp_session_id=s.id and g.status in ('enfileirado','processando')) < 5
      and ((select count(*) from public.envios e where e.account_id=l.account_id and e.status in ('enfileirado','processando'))
         + (select count(*) from public.envios_grupo g where g.account_id=l.account_id and g.status in ('enfileirado','processando'))) < p_account_concurrency
    order by s.last_queue_claimed_at nulls first,s.id
    for update of l skip locked
    limit p_limit
  loop
    select g.lote_id into active_group_batch
    from public.envios_grupo g
    where g.whatsapp_session_id=lane.whatsapp_session_id
      and g.status in ('enfileirado','processando')
    order by g.claimed_at, g.created_at limit 1;

    job:=null;
    select * into job from (
      select e.id,'envios'::text table_name,'alta'::text job_priority,e.scheduled_at,e.created_at,coalesce(e.attempts,0) attempts
      from public.envios e
      where active_group_batch is null and e.account_id=lane.account_id and e.whatsapp_session_id=lane.whatsapp_session_id
        and e.status='pendente' and e.scheduled_at<=now() and (e.next_attempt_at is null or e.next_attempt_at<=now())
      union all
      select g.id,'envios_grupo','normal',g.scheduled_at,g.created_at,coalesce(g.attempts,0)
      from public.envios_grupo g
      where g.account_id=lane.account_id and g.whatsapp_session_id=lane.whatsapp_session_id
        and g.status='pendente' and g.scheduled_at<=now() and (g.next_attempt_at is null or g.next_attempt_at<=now())
        and g.lote_id=coalesce(active_group_batch,(
          select first_due.lote_id from public.envios_grupo first_due
          where first_due.account_id=lane.account_id and first_due.whatsapp_session_id=lane.whatsapp_session_id
            and first_due.status='pendente' and first_due.scheduled_at<=now()
            and (first_due.next_attempt_at is null or first_due.next_attempt_at<=now())
          order by first_due.scheduled_at,first_due.created_at limit 1
        ))
    ) due order by case when job_priority='alta' then 0 else 1 end,scheduled_at,created_at limit 1;

    if found and job.id is not null then
      token:=gen_random_uuid();
      if job.table_name='envios' then
        update public.envios e set status='enfileirado',claimed_at=now(),claim_token=token,
          processing_deadline_at=now()+make_interval(secs=>p_processing_seconds),processing_worker_id=p_worker_id,
          processing_lease_version=lane.lease_version,updated_at=now()
        where e.id=job.id and e.status='pendente' and e.account_id=lane.account_id and e.whatsapp_session_id=lane.whatsapp_session_id;
      else
        update public.envios_grupo g set status='enfileirado',claimed_at=now(),claim_token=token,
          processing_deadline_at=now()+make_interval(secs=>p_processing_seconds),processing_worker_id=p_worker_id,
          processing_lease_version=lane.lease_version,updated_at=now()
        where g.id=job.id and g.status='pendente' and g.account_id=lane.account_id and g.whatsapp_session_id=lane.whatsapp_session_id;
        update public.envios_grupo_lotes set status='processando',started_at=coalesce(started_at,now()),updated_at=now()
        where public.envios_grupo_lotes.id=(select selected_group.lote_id from public.envios_grupo selected_group where selected_group.id=job.id)
          and public.envios_grupo_lotes.account_id=lane.account_id
          and public.envios_grupo_lotes.status in ('pendente','processando');
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

revoke all on function public.claim_whatsapp_jobs(text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_jobs(text,integer,integer,integer) to service_role;
