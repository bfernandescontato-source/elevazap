-- Fixes the QR/connection lease function without changing queue state.
create or replace function public.acquire_whatsapp_session_lease(
  p_worker_id text,p_session_id uuid,p_ttl_seconds integer
) returns table(whatsapp_session_id uuid,account_id uuid,lease_version bigint)
language plpgsql security definer set search_path = pg_catalog, public as $$
#variable_conflict use_column
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
  on conflict on constraint whatsapp_session_leases_pkey do update set
    owner_worker_id=excluded.owner_worker_id,account_id=excluded.account_id,lease_expires_at=excluded.lease_expires_at,
    lease_version=case when l.owner_worker_id=excluded.owner_worker_id and l.lease_expires_at>now() then l.lease_version else l.lease_version+1 end,
    acquired_at=case when l.owner_worker_id=excluded.owner_worker_id and l.lease_expires_at>now() then l.acquired_at else now() end,
    renewed_at=now(),updated_at=now()
  where l.owner_worker_id=p_worker_id or l.lease_expires_at<=now()
  returning l.lease_version into new_version;
  if new_version is not null then
    whatsapp_session_id:=p_session_id;account_id:=sender_account;lease_version:=new_version;return next;
  end if;
end $$;

revoke all on function public.acquire_whatsapp_session_lease(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.acquire_whatsapp_session_lease(text,uuid,integer) to service_role;
