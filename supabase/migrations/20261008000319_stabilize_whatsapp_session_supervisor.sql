-- Mantém as sessões estáveis quando a Data API sofre uma pausa curta. O mesmo
-- worker pode renovar um lease vencido enquanto ninguém o tomou; a versão ainda
-- impede que um worker antigo recupere uma sessão já assumida por outro.
create or replace function public.renew_whatsapp_session_leases(
  p_worker_id text,
  p_leases jsonb,
  p_ttl_seconds integer
) returns table(whatsapp_session_id uuid, lease_version bigint)
language sql security definer set search_path = pg_catalog, public as $$
  with requested as (
    select (item->>'whatsapp_session_id')::uuid as session_id,
           (item->>'lease_version')::bigint as version
      from jsonb_array_elements(coalesce(p_leases, '[]'::jsonb)) as item
  ), renewed as (
    update public.whatsapp_session_leases as lease
       set lease_expires_at = now() + make_interval(secs => p_ttl_seconds),
           renewed_at = now(), updated_at = now()
      from requested
     where p_ttl_seconds between 15 and 300
       and lease.whatsapp_session_id = requested.session_id
       and lease.owner_worker_id = p_worker_id
       and lease.lease_version = requested.version
    returning lease.whatsapp_session_id, lease.lease_version
  ) select * from renewed
$$;

create or replace function public.heartbeat_whatsapp_session_runtime(
  p_worker_id text, p_sessions jsonb
) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare changed integer;
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'Worker inválido.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
      as requested(whatsapp_session_id uuid, lease_version bigint, status text, error text)
    where requested.status not in (
      'idle','disconnected','starting','waiting_qr','connected','reconnecting','logged_out','failed'
    )
  ) then
    raise exception 'Status inválido.' using errcode = '22023';
  end if;
  with requested as (
    select whatsapp_session_id, lease_version,
           case when status='idle' then 'disconnected' else status end as status,
           error
      from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
        as item(whatsapp_session_id uuid, lease_version bigint, status text, error text)
  )
  update public.whatsapp_senders as sender
     set connection_status=requested.status, connection_heartbeat_at=now(),
         last_connection_error=requested.error, updated_at=now()
    from requested
    join public.whatsapp_session_leases as lease
      on lease.whatsapp_session_id=requested.whatsapp_session_id
     and lease.owner_worker_id=p_worker_id
     and lease.lease_version=requested.lease_version
     and lease.lease_expires_at>now()
   where sender.id=requested.whatsapp_session_id;
  get diagnostics changed = row_count;
  return changed;
end $$;

revoke all on function public.renew_whatsapp_session_leases(text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.renew_whatsapp_session_leases(text,jsonb,integer) to service_role;
revoke all on function public.heartbeat_whatsapp_session_runtime(text,jsonb) from public,anon,authenticated;
grant execute on function public.heartbeat_whatsapp_session_runtime(text,jsonb) to service_role;
