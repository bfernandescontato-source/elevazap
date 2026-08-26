create or replace function public.acquire_whatsapp_session_leases(
  p_worker_id text,p_limit integer,p_ttl_seconds integer
) returns table(whatsapp_session_id uuid,account_id uuid,lease_version bigint)
language plpgsql security definer set search_path = pg_catalog, public as $$
#variable_conflict use_column
declare candidate record; owned_count integer;
begin
  if nullif(trim(p_worker_id),'') is null or p_limit not between 1 and 1000 or p_ttl_seconds not between 15 and 300 then
    raise exception 'Parâmetros de lease inválidos.' using errcode='22023';
  end if;
  select count(*) into owned_count from public.whatsapp_session_leases l
    where l.owner_worker_id=p_worker_id and l.lease_expires_at>now();
  for candidate in
    select s.id,s.account_id from public.whatsapp_senders s
    join public.accounts a on a.id=s.account_id and a.status='active'
    left join public.whatsapp_session_leases l on l.whatsapp_session_id=s.id
    where l.whatsapp_session_id is null or l.owner_worker_id=p_worker_id or l.lease_expires_at<=now()
    order by (l.owner_worker_id=p_worker_id) desc nulls last,l.lease_expires_at nulls first,s.created_at
    for update of s skip locked limit greatest(0,p_limit-owned_count)
  loop
    insert into public.whatsapp_session_leases as l
      (whatsapp_session_id,account_id,owner_worker_id,lease_expires_at,lease_version,acquired_at,renewed_at,updated_at)
    values (candidate.id,candidate.account_id,p_worker_id,now()+make_interval(secs=>p_ttl_seconds),1,now(),now(),now())
    on conflict on constraint whatsapp_session_leases_pkey do update set
      account_id=excluded.account_id,owner_worker_id=excluded.owner_worker_id,lease_expires_at=excluded.lease_expires_at,
      lease_version=case when l.owner_worker_id=excluded.owner_worker_id and l.lease_expires_at>now() then l.lease_version else l.lease_version+1 end,
      acquired_at=case when l.owner_worker_id=excluded.owner_worker_id and l.lease_expires_at>now() then l.acquired_at else now() end,
      renewed_at=now(),updated_at=now()
    where l.owner_worker_id=p_worker_id or l.lease_expires_at<=now();
  end loop;
  return query select l.whatsapp_session_id,l.account_id,l.lease_version
    from public.whatsapp_session_leases l
    where l.owner_worker_id=p_worker_id and l.lease_expires_at>now()
    order by l.acquired_at limit p_limit;
end $$;

revoke all on function public.acquire_whatsapp_session_leases(text,integer,integer) from public,anon,authenticated;
grant execute on function public.acquire_whatsapp_session_leases(text,integer,integer) to service_role;
