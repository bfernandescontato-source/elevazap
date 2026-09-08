begin;

-- captured_offers is already the durable Pilot backlog. The five-item admission
-- counter sat in front of that backlog and irreversibly converted valid offers
-- to ignored. Remove it as a control mechanism; the due-time WhatsApp queue is
-- responsible for flow control.
drop trigger if exists manage_offer_queue_capacity on public.captured_offers;
drop trigger if exists release_deleted_offer_queue_capacity on public.captured_offers;
drop function if exists public.manage_offer_queue_capacity();
drop function if exists public.release_deleted_offer_queue_capacity();
alter table public.offer_automations drop column if exists active_queue_count;

alter table public.captured_offers
  add column if not exists processing_worker_id text,
  add column if not exists processing_deadline_at timestamptz,
  add column if not exists processing_attempts integer not null default 0
    check (processing_attempts >= 0);

create index if not exists captured_offers_processing_recovery_idx
  on public.captured_offers(processing_deadline_at, updated_at, id)
  where status = 'processing';

-- A worker that dies while converting or preparing an offer leaves the durable
-- row in processing. Claim expired rows with row locks so only one live worker
-- resumes each offer.
create or replace function public.claim_interrupted_pilot_offers(
  p_worker_id text,
  p_limit integer default 10,
  p_processing_seconds integer default 900
)
returns table(offer_id uuid, account_id uuid)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if nullif(trim(p_worker_id), '') is null
     or p_limit not between 1 and 100
     or p_processing_seconds not between 60 and 3600 then
    raise exception 'Parâmetros de recuperação inválidos.' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select captured.id
      from public.captured_offers captured
      join public.offer_automations automation
        on automation.id = captured.automation_id
       and automation.account_id = captured.account_id
       and automation.enabled = true
      join public.accounts account_row
        on account_row.id = captured.account_id
       and account_row.status = 'active'
     where captured.status = 'processing'
       and (
         captured.processing_deadline_at < now()
         or (
           captured.processing_deadline_at is null
           and captured.updated_at < now() - make_interval(secs => p_processing_seconds)
         )
       )
     order by captured.captured_at, captured.id
     for update of captured skip locked
     limit p_limit
  )
  update public.captured_offers captured
     set processing_worker_id = p_worker_id,
         processing_deadline_at = now() + make_interval(secs => p_processing_seconds),
         processing_attempts = captured.processing_attempts + 1,
         error_code = null,
         error_message = null,
         updated_at = now()
    from candidates
   where captured.id = candidates.id
  returning captured.id, captured.account_id;
end;
$$;

revoke all on function public.claim_interrupted_pilot_offers(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_interrupted_pilot_offers(text, integer, integer) to service_role;

-- Build the lot, group dispatches, delivery links and final offer state in one
-- database transaction. Locking the offer prevents duplicate construction; the
-- automation lock serializes slot reservation for simultaneous captures.
create or replace function public.schedule_pilot_offer(
  p_offer_id uuid,
  p_worker_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_offer public.captured_offers;
  v_automation public.offer_automations;
  v_sender public.whatsapp_senders;
  v_lote_id uuid;
  v_destination_count integer;
  v_base_at timestamptz;
  v_local_base timestamp;
  v_scheduled_local timestamp;
  v_scheduled_at timestamptz;
  v_message_type text;
  v_message_text text;
  v_existing_delivery_count integer;
  v_existing_sent_count integer;
  v_existing_cancelled_count integer;
  v_existing_terminal_count integer;
  v_existing_sending_count integer;
  v_existing_status text;
  v_effective_now timestamptz;
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'Identificador do worker inválido.' using errcode = '22023';
  end if;

  select * into v_offer
    from public.captured_offers
   where id = p_offer_id
   for update;
  if not found then
    raise exception 'Oferta não encontrada.' using errcode = 'P0002';
  end if;

  -- A repeated RPC after a lost network response must be read-only.
  if v_offer.status in ('scheduled', 'sending', 'sent') then
    return jsonb_build_object(
      'status', v_offer.status,
      'scheduled_at', v_offer.scheduled_at,
      'already_scheduled', true
    );
  end if;
  if v_offer.status not in ('processing', 'ready') then
    raise exception 'Oferta não está pronta para agendamento.' using errcode = 'P0001';
  end if;
  if v_offer.status = 'processing'
     and v_offer.processing_worker_id is distinct from p_worker_id then
    raise exception 'O processamento da oferta pertence a outro worker.' using errcode = '40001';
  end if;

  -- A deployment from the former multi-step scheduler may have committed
  -- deliveries before it committed the offer status. Adopt that work instead
  -- of constructing a second set of group dispatches.
  select count(*)::integer,
         count(*) filter (where delivery.status = 'sent')::integer,
         count(*) filter (where delivery.status = 'cancelled')::integer,
         count(*) filter (where delivery.status in ('sent', 'failed', 'uncertain', 'cancelled'))::integer,
         count(*) filter (where delivery.status = 'sending')::integer
    into v_existing_delivery_count, v_existing_sent_count,
         v_existing_cancelled_count, v_existing_terminal_count,
         v_existing_sending_count
    from public.offer_deliveries delivery
   where delivery.offer_id = v_offer.id
     and delivery.account_id = v_offer.account_id;
  if v_existing_delivery_count > 0 then
    v_existing_status := case
      when v_existing_cancelled_count = v_existing_delivery_count then 'ignored'
      when v_existing_terminal_count = v_existing_delivery_count and v_existing_sent_count > 0 then 'sent'
      when v_existing_terminal_count = v_existing_delivery_count then 'send_failed'
      when v_existing_sending_count > 0 then 'sending'
      else 'scheduled'
    end;
    update public.captured_offers
       set status = v_existing_status,
           processing_worker_id = null,
           processing_deadline_at = null,
           updated_at = now()
     where id = v_offer.id;
    return jsonb_build_object(
      'status', v_existing_status,
      'scheduled_at', v_offer.scheduled_at,
      'destinations', v_existing_delivery_count,
      'already_scheduled', true
    );
  end if;

  select * into v_automation
    from public.offer_automations
   where id = v_offer.automation_id
     and account_id = v_offer.account_id
   for update;
  if not found then
    raise exception 'Automação não encontrada.' using errcode = 'P0002';
  end if;
  if not v_automation.enabled then
    update public.captured_offers
       set status = 'ignored',
           error_code = 'PILOT_DISABLED',
           error_message = 'Piloto Automático desativado.',
           processed_at = coalesce(processed_at, now()),
           processing_worker_id = null,
           processing_deadline_at = null,
           updated_at = now()
     where id = v_offer.id;
    return jsonb_build_object('status', 'ignored', 'reason', 'PILOT_DISABLED');
  end if;

  select * into v_sender
    from public.whatsapp_senders
   where id = v_automation.whatsapp_sender_id
     and account_id = v_automation.account_id;
  if not found then
    raise exception 'Número responsável não encontrado.' using errcode = 'P0002';
  end if;

  select count(*)::integer into v_destination_count
    from public.automation_destinations
   where account_id = v_automation.account_id
     and automation_id = v_automation.id
     and enabled = true;
  if v_destination_count = 0 then
    update public.captured_offers
     set status = 'ready',
           processed_at = coalesce(processed_at, now()),
           processing_worker_id = null,
           processing_deadline_at = null,
           updated_at = now()
     where id = v_offer.id;
    return jsonb_build_object('status', 'ready', 'destinations', 0);
  end if;

  if v_automation.operating_start >= v_automation.operating_end then
    raise exception 'A janela de funcionamento da automação é inválida.' using errcode = '22023';
  end if;
  v_effective_now := coalesce(p_now, now());
  v_base_at := greatest(v_effective_now, coalesce(v_automation.pilot_next_slot_at, v_effective_now));
  v_local_base := v_base_at at time zone v_automation.timezone;
  if v_local_base::time < v_automation.operating_start then
    v_scheduled_local := v_local_base::date + v_automation.operating_start;
  elsif v_local_base::time > v_automation.operating_end then
    v_scheduled_local := (v_local_base::date + 1) + v_automation.operating_start;
  else
    v_scheduled_local := v_local_base;
  end if;
  v_scheduled_at := v_scheduled_local at time zone v_automation.timezone;

  update public.offer_automations
     set pilot_next_slot_at = v_scheduled_at + make_interval(mins => v_automation.interval_minutes),
         updated_at = now()
   where id = v_automation.id;

  v_message_type := case
    when v_automation.keep_original_media and v_offer.media_bucket is not null and v_offer.media_path is not null
      then 'imagem'
    else 'texto'
  end;
  v_message_text := case when v_automation.keep_original_text then coalesce(v_offer.processed_text, v_offer.original_text, '') else '' end;

  insert into public.envios_grupo_lotes (
    account_id, titulo, whatsapp_sender_id, whatsapp_session_name, tipo,
    texto, legenda, media_bucket, media_path, mime_type, file_name,
    status, total, pendentes, scheduled_at
  ) values (
    v_automation.account_id,
    'Piloto Automático · ' || left(replace(coalesce(v_offer.original_text, 'Oferta'), E'\n', ' '), 70),
    v_automation.whatsapp_sender_id, v_sender.session_name, v_message_type,
    case when v_message_type = 'texto' then v_message_text else null end,
    case when v_message_type = 'imagem' then v_message_text else null end,
    case when v_message_type = 'imagem' then v_offer.media_bucket else null end,
    case when v_message_type = 'imagem' then v_offer.media_path else null end,
    case when v_message_type = 'imagem' then v_offer.media_mime_type else null end,
    case when v_message_type = 'imagem' then 'oferta-' || v_offer.id::text || '.jpg' else null end,
    'pendente', v_destination_count, v_destination_count, v_scheduled_at
  ) returning id into v_lote_id;

  with destinations as (
    select destination.whatsapp_group_id, group_row.nome
      from public.automation_destinations destination
      left join public.grupos group_row
        on group_row.account_id = destination.account_id
       and group_row.group_jid = destination.whatsapp_group_id
     where destination.account_id = v_automation.account_id
       and destination.automation_id = v_automation.id
       and destination.enabled = true
  ), dispatches as (
    insert into public.envios_grupo (
      account_id, lote_id, whatsapp_sender_id, whatsapp_session_name,
      group_jid, nome_grupo, tipo, texto, legenda, media_bucket, media_path,
      mime_type, file_name, status, scheduled_at, idempotency_key
    )
    select v_automation.account_id, v_lote_id, v_automation.whatsapp_sender_id, v_sender.session_name,
           destination.whatsapp_group_id, destination.nome, v_message_type,
           case when v_message_type = 'texto' then v_message_text else null end,
           case when v_message_type = 'imagem' then v_message_text else null end,
           case when v_message_type = 'imagem' then v_offer.media_bucket else null end,
           case when v_message_type = 'imagem' then v_offer.media_path else null end,
           case when v_message_type = 'imagem' then v_offer.media_mime_type else null end,
           case when v_message_type = 'imagem' then 'oferta-' || v_offer.id::text || '.jpg' else null end,
           'pendente', v_scheduled_at,
           'pilot:' || v_offer.id::text || ':' || destination.whatsapp_group_id
      from destinations destination
    returning id, group_jid
  )
  insert into public.offer_deliveries (
    account_id, offer_id, destination_group_id, group_dispatch_id,
    link_used, status, scheduled_at
  )
  select v_automation.account_id, v_offer.id, dispatch.group_jid, dispatch.id,
         coalesce(v_offer.affiliate_link, v_offer.original_link), 'scheduled', v_scheduled_at
    from dispatches dispatch;

  update public.captured_offers
     set status = 'scheduled',
         error_code = null,
         error_message = null,
         processed_at = coalesce(processed_at, now()),
         scheduled_at = v_scheduled_at,
         processing_worker_id = null,
         processing_deadline_at = null,
         updated_at = now()
   where id = v_offer.id;

  return jsonb_build_object(
    'status', 'scheduled',
    'scheduled_at', v_scheduled_at,
    'destinations', v_destination_count,
    'already_scheduled', false
  );
end;
$$;

revoke all on function public.schedule_pilot_offer(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_pilot_offer(uuid, text, timestamptz) to service_role;

-- Do not leave legacy rows permanently in processing when their owner is not
-- eligible to resume them. They remain auditable and are never dispatched.
update public.captured_offers captured
   set status = 'ignored',
       error_code = case when automation.enabled then 'ACCOUNT_INACTIVE' else 'PILOT_DISABLED' end,
       error_message = case when automation.enabled then 'Assinatura inativa.' else 'Piloto Automático desativado.' end,
       processed_at = coalesce(captured.processed_at, now()),
       processing_worker_id = null,
       processing_deadline_at = null,
       updated_at = now()
  from public.offer_automations automation,
       public.accounts account_row
 where captured.automation_id = automation.id
   and captured.account_id = automation.account_id
   and account_row.id = captured.account_id
   and captured.status = 'processing'
   and (not automation.enabled or account_row.status <> 'active');

-- Recover recent offers discarded by the old cap for every active account. They
-- are resumed by the worker from the same durable row, preserving idempotency.
update public.captured_offers captured
   set status = 'processing',
       error_code = null,
       error_message = null,
       processed_at = null,
       processing_worker_id = null,
       processing_deadline_at = now(),
       processing_attempts = 0,
       updated_at = now()
  from public.offer_automations automation,
       public.accounts account_row
 where captured.automation_id = automation.id
   and captured.account_id = automation.account_id
   and account_row.id = captured.account_id
   and automation.enabled = true
   and account_row.status = 'active'
   and captured.status = 'ignored'
   and captured.error_code = 'PILOT_QUEUE_FULL'
   and captured.captured_at >= now() - interval '24 hours';

commit;
