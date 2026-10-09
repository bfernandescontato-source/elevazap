-- Pausa operacional de número, independente do lease técnico (09/10/2026).
-- Antes, "estacionar" = trocar o dono do lease com vencimento; ao vencer, o número voltava sozinho
-- para o worker (mesmo os que travavam o serviço). Agora a pausa tem motivo, responsável e condição
-- de retorno, e o worker não assume número pausado. Retomar = apagar a linha da pausa.
create table if not exists public.whatsapp_sender_pauses (
  whatsapp_sender_id uuid primary key references public.whatsapp_senders(id) on delete cascade,
  account_id uuid not null,
  reason text not null,
  paused_by text not null,
  paused_at timestamptz not null default now(),
  resume_condition text
);
alter table public.whatsapp_sender_pauses enable row level security;
revoke all on public.whatsapp_sender_pauses from anon, authenticated;

CREATE OR REPLACE FUNCTION public.acquire_whatsapp_session_leases(p_worker_id text, p_limit integer, p_ttl_seconds integer)
 RETURNS TABLE(whatsapp_session_id uuid, account_id uuid, lease_version bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    where (l.whatsapp_session_id is null or l.owner_worker_id=p_worker_id or l.lease_expires_at<=now())
      and not exists (select 1 from public.whatsapp_sender_pauses p where p.whatsapp_sender_id=s.id)
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
end $function$;
