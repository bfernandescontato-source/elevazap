-- Pausa operacional de número, independente do lease técnico (09/10/2026).
-- Antes, "estacionar" = trocar o dono do lease com vencimento; ao vencer, o número voltava sozinho
-- para o worker (mesmo os que travavam o serviço). Agora a pausa tem motivo, responsável e condição
-- de retorno, e nenhum caminho do worker usa número pausado:
--   1. aquisição em lote (supervisor): não escolhe, não conta e não devolve número pausado; um lease
--      já próprio de número pausado deixa de ser devolvido e o serviço para a sessão (lease_not_owned);
--   2. renovação: não renova lease de número pausado (o serviço para a sessão: lease_lost);
--   3. aquisição individual (conectar/reiniciar pelo painel): recusa com mensagem clara;
--   4. validação antes do envio: lease de número pausado não vale, a fila não envia por ele.
-- Retomar = apagar a linha da pausa (resume_whatsapp_sender). Os demais números não são afetados:
-- o filtro é por número e a pausa não conta no limite de sessões do worker.
create table if not exists public.whatsapp_sender_pauses (
  whatsapp_sender_id uuid primary key references public.whatsapp_senders(id) on delete cascade,
  account_id uuid not null,
  reason text not null,
  paused_by text not null,
  paused_at timestamptz not null default now(),
  resume_condition text
);
alter table public.whatsapp_sender_pauses enable row level security;
revoke all on public.whatsapp_sender_pauses from public, anon, authenticated;

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
    where l.owner_worker_id=p_worker_id and l.lease_expires_at>now()
      and not exists (select 1 from public.whatsapp_sender_pauses p where p.whatsapp_sender_id=l.whatsapp_session_id);
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
      and not exists (select 1 from public.whatsapp_sender_pauses p where p.whatsapp_sender_id=l.whatsapp_session_id)
    order by l.acquired_at limit p_limit;
end $function$;

CREATE OR REPLACE FUNCTION public.acquire_whatsapp_session_lease(p_worker_id text, p_session_id uuid, p_ttl_seconds integer)
 RETURNS TABLE(whatsapp_session_id uuid, account_id uuid, lease_version bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
declare
  sender_account uuid;
  new_version bigint;
begin
  if nullif(trim(p_worker_id), '') is null
     or p_ttl_seconds not between 15 and 300 then
    raise exception 'Parâmetros de lease inválidos.' using errcode = '22023';
  end if;

  if exists (select 1 from public.whatsapp_sender_pauses p where p.whatsapp_sender_id = p_session_id) then
    raise exception 'Número pausado pela operação. Fale com o suporte para retomar.' using errcode = 'P0001';
  end if;

  select s.account_id into sender_account
  from public.whatsapp_senders s
  join public.accounts a on a.id = s.account_id and a.status = 'active'
  where s.id = p_session_id
  for update of s;

  if sender_account is null then
    return;
  end if;

  insert into public.whatsapp_session_leases as l (
    whatsapp_session_id, account_id, owner_worker_id, lease_expires_at,
    lease_version, acquired_at, renewed_at, updated_at
  )
  values (
    p_session_id, sender_account, p_worker_id,
    now() + make_interval(secs => p_ttl_seconds),
    1, now(), now(), now()
  )
  on conflict on constraint whatsapp_session_leases_pkey do update
  set
    account_id = excluded.account_id,
    owner_worker_id = excluded.owner_worker_id,
    lease_expires_at = excluded.lease_expires_at,
    lease_version = case
      when l.owner_worker_id = excluded.owner_worker_id
       and l.lease_expires_at > now()
      then l.lease_version
      else l.lease_version + 1
    end,
    acquired_at = case
      when l.owner_worker_id = excluded.owner_worker_id
       and l.lease_expires_at > now()
      then l.acquired_at
      else now()
    end,
    renewed_at = now(),
    updated_at = now()
  where l.owner_worker_id = p_worker_id
     or l.lease_expires_at <= now()
  returning l.lease_version into new_version;

  if new_version is not null then
    whatsapp_session_id := p_session_id;
    account_id := sender_account;
    lease_version := new_version;
    return next;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.renew_whatsapp_session_leases(p_worker_id text, p_leases jsonb, p_ttl_seconds integer)
 RETURNS TABLE(whatsapp_session_id uuid, lease_version bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
       and not exists (select 1 from public.whatsapp_sender_pauses p where p.whatsapp_sender_id = lease.whatsapp_session_id)
    returning lease.whatsapp_session_id, lease.lease_version
  ) select * from renewed
$function$;

CREATE OR REPLACE FUNCTION public.validate_whatsapp_session_lease(p_worker_id text, p_session_id uuid, p_lease_version bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists(select 1 from public.whatsapp_session_leases l
    where l.whatsapp_session_id=p_session_id and l.owner_worker_id=p_worker_id
      and l.lease_version=p_lease_version and l.lease_expires_at>now())
    and not exists (select 1 from public.whatsapp_sender_pauses p where p.whatsapp_sender_id=p_session_id)
$function$;

-- Retomada autorizada de UM número: apaga a pausa. Se o lease ainda estiver com um dono de
-- estacionamento manual ("parked-..."), vence agora para o worker poder assumir no próximo ciclo.
-- Não mexe em lease de worker real nem em outros números.
create or replace function public.resume_whatsapp_sender(p_sender_id uuid)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_deleted integer; v_expired integer;
begin
  delete from public.whatsapp_sender_pauses where whatsapp_sender_id = p_sender_id;
  get diagnostics v_deleted = row_count;
  update public.whatsapp_session_leases
     set lease_expires_at = now(), updated_at = now()
   where whatsapp_session_id = p_sender_id and owner_worker_id like 'parked-%' and lease_expires_at > now();
  get diagnostics v_expired = row_count;
  return 'pausa removida: ' || v_deleted || ', estacionamento vencido: ' || v_expired;
end;
$function$;

revoke all on function public.resume_whatsapp_sender(uuid) from public, anon, authenticated;
