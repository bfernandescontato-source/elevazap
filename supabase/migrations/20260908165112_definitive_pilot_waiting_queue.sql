begin;

-- Definitive Pilot queue: captured_offers is the durable queue. At most five
-- offers per automation own future WhatsApp jobs; every excess offer remains
-- as waiting without a schedule, lot or delivery.

alter table public.captured_offers
  drop constraint if exists captured_offers_status_check;
alter table public.captured_offers
  add constraint captured_offers_status_check check (
    status in (
      'captured','processing','ready','waiting','scheduled','sending','sent',
      'ignored','duplicate','processing_failed','send_failed'
    )
  );
alter table public.captured_offers
  add constraint captured_offers_waiting_has_no_schedule check (
    status <> 'waiting' or scheduled_at is null
  );

create index if not exists captured_offers_waiting_fifo_idx
  on public.captured_offers(automation_id, captured_at, id)
  where status = 'waiting';

alter table public.offer_automations
  add column if not exists pilot_reset_at timestamptz;
update public.offer_automations
   set pilot_reset_at = created_at
 where pilot_reset_at is null;
alter table public.offer_automations
  alter column pilot_reset_at set default now(),
  alter column pilot_reset_at set not null;

-- Internal primitive. Its callers must lock the offer and automation first.
-- EXECUTE is revoked below so it cannot become a public scheduling bypass.
create or replace function public.create_pilot_offer_schedule_locked(
  p_offer_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
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
  v_effective_now timestamptz;
begin
  select * into v_offer from public.captured_offers where id = p_offer_id;
  if not found then
    raise exception 'Oferta não encontrada.' using errcode = 'P0002';
  end if;
  if v_offer.status not in ('processing', 'ready', 'waiting') then
    raise exception 'Oferta não está pronta para agendamento.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.offer_deliveries where offer_id = v_offer.id) then
    raise exception 'Oferta em espera já possui entregas.' using errcode = '23505';
  end if;

  select * into v_automation
    from public.offer_automations
   where id = v_offer.automation_id and account_id = v_offer.account_id;
  if not found then raise exception 'Automação não encontrada.' using errcode = 'P0002'; end if;
  if not v_automation.enabled or v_offer.captured_at < v_automation.pilot_reset_at then
    update public.captured_offers
       set status = 'ignored', error_code = 'PILOT_DISABLED',
           error_message = 'Oferta anterior à ativação atual do Piloto.',
           processed_at = coalesce(processed_at, now()), scheduled_at = null,
           processing_worker_id = null, processing_deadline_at = null, updated_at = now()
     where id = v_offer.id;
    return jsonb_build_object('status', 'ignored', 'reason', 'PILOT_DISABLED');
  end if;
  if v_offer.queue_quarantined_at is not null
     or v_offer.error_code = 'PILOT_QUEUE_QUARANTINED' then
    raise exception 'Oferta em quarentena não pode ser agendada.' using errcode = 'P0001';
  end if;

  select * into v_sender
    from public.whatsapp_senders
   where id = v_automation.whatsapp_sender_id and account_id = v_automation.account_id;
  if not found then raise exception 'Número responsável não encontrado.' using errcode = 'P0002'; end if;

  select count(*)::integer into v_destination_count
    from public.automation_destinations
   where account_id = v_automation.account_id
     and automation_id = v_automation.id and enabled = true;
  if v_destination_count = 0 then
    update public.captured_offers
       set status = 'ready', processed_at = coalesce(processed_at, now()), scheduled_at = null,
           processing_worker_id = null, processing_deadline_at = null, updated_at = now()
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
      then 'imagem' else 'texto' end;
  v_message_text := case when v_automation.keep_original_text
    then coalesce(v_offer.processed_text, v_offer.original_text, '') else '' end;

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
       and destination.automation_id = v_automation.id and destination.enabled = true
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
     set status = 'scheduled', error_code = null, error_message = null,
         processed_at = coalesce(processed_at, now()), scheduled_at = v_scheduled_at,
         processing_worker_id = null, processing_deadline_at = null, updated_at = now()
   where id = v_offer.id;

  return jsonb_build_object('status', 'scheduled', 'scheduled_at', v_scheduled_at,
    'destinations', v_destination_count, 'already_scheduled', false);
end;
$$;

revoke all on function public.create_pilot_offer_schedule_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.promote_waiting_pilot_offers(
  p_automation_id uuid,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_automation public.offer_automations;
  v_offer_id uuid;
  v_slots integer;
  v_promoted integer := 0;
  v_result jsonb;
begin
  select * into v_automation
    from public.offer_automations where id = p_automation_id for update;
  if not found or not v_automation.enabled then return 0; end if;

  loop
    select count(*)::integer into v_slots
      from public.captured_offers
     where automation_id = v_automation.id
       and account_id = v_automation.account_id
       and status in ('scheduled', 'sending');
    exit when v_slots >= 5;

    select offer.id into v_offer_id
      from public.captured_offers offer
     where offer.automation_id = v_automation.id
       and offer.account_id = v_automation.account_id
       and offer.status = 'waiting'
       and offer.captured_at >= v_automation.pilot_reset_at
       and offer.queue_quarantined_at is null
       and offer.error_code is distinct from 'PILOT_QUEUE_QUARANTINED'
       and not exists (select 1 from public.offer_deliveries delivery where delivery.offer_id = offer.id)
     order by offer.captured_at, offer.id
     for update skip locked
     limit 1;
    exit when v_offer_id is null;

    begin
      v_result := public.create_pilot_offer_schedule_locked(v_offer_id, p_now);
      if v_result->>'status' = 'scheduled' then v_promoted := v_promoted + 1; end if;
    exception when others then
      update public.captured_offers
         set error_code = 'WAITING_PROMOTION_FAILED',
             error_message = left(sqlerrm, 1000), updated_at = now()
       where id = v_offer_id and status = 'waiting';
      raise warning 'Falha ao promover oferta waiting %: %', v_offer_id, sqlerrm;
      exit;
    end;
    v_offer_id := null;
  end loop;
  return v_promoted;
end;
$$;

revoke all on function public.promote_waiting_pilot_offers(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.schedule_pilot_offer(
  p_offer_id uuid,
  p_worker_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_offer public.captured_offers;
  v_automation public.offer_automations;
  v_existing_delivery_count integer;
  v_existing_sent_count integer;
  v_existing_cancelled_count integer;
  v_existing_terminal_count integer;
  v_existing_sending_count integer;
  v_existing_status text;
  v_destinations integer;
  v_result jsonb;
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'Identificador do worker inválido.' using errcode = '22023';
  end if;
  select * into v_offer from public.captured_offers where id = p_offer_id for update;
  if not found then raise exception 'Oferta não encontrada.' using errcode = 'P0002'; end if;

  if v_offer.status in ('waiting', 'scheduled', 'sending', 'sent') then
    return jsonb_build_object('status', v_offer.status, 'scheduled_at', v_offer.scheduled_at,
      'already_scheduled', true);
  end if;
  if v_offer.status not in ('processing', 'ready') then
    raise exception 'Oferta não está pronta para agendamento.' using errcode = 'P0001';
  end if;
  if v_offer.status = 'processing' and (
       v_offer.processing_worker_id is distinct from p_worker_id
       or v_offer.processing_deadline_at is null
       or v_offer.processing_deadline_at <= now()
     ) then
    raise exception 'Lease de processamento inválido ou expirado.' using errcode = '40001';
  end if;
  if v_offer.queue_quarantined_at is not null
     or v_offer.error_code = 'PILOT_QUEUE_QUARANTINED' then
    raise exception 'Oferta em quarentena não pode ser agendada.' using errcode = 'P0001';
  end if;

  select count(*)::integer,
         count(*) filter (where status = 'sent')::integer,
         count(*) filter (where status = 'cancelled')::integer,
         count(*) filter (where status in ('sent','failed','uncertain','cancelled'))::integer,
         count(*) filter (where status = 'sending')::integer
    into v_existing_delivery_count, v_existing_sent_count, v_existing_cancelled_count,
         v_existing_terminal_count, v_existing_sending_count
    from public.offer_deliveries where offer_id = v_offer.id and account_id = v_offer.account_id;
  if v_existing_delivery_count > 0 then
    v_existing_status := case
      when v_existing_cancelled_count = v_existing_delivery_count then 'ignored'
      when v_existing_terminal_count = v_existing_delivery_count and v_existing_sent_count > 0 then 'sent'
      when v_existing_terminal_count = v_existing_delivery_count then 'send_failed'
      when v_existing_sending_count > 0 then 'sending' else 'scheduled' end;
    update public.captured_offers set status = v_existing_status,
      processing_worker_id = null, processing_deadline_at = null, updated_at = now()
     where id = v_offer.id;
    return jsonb_build_object('status', v_existing_status, 'scheduled_at', v_offer.scheduled_at,
      'destinations', v_existing_delivery_count, 'already_scheduled', true);
  end if;

  select * into v_automation from public.offer_automations
   where id = v_offer.automation_id and account_id = v_offer.account_id for update;
  if not found then raise exception 'Automação não encontrada.' using errcode = 'P0002'; end if;
  if not v_automation.enabled or v_offer.captured_at < v_automation.pilot_reset_at then
    update public.captured_offers set status='ignored', error_code='PILOT_DISABLED',
      error_message='Oferta anterior à ativação atual do Piloto.', processed_at=coalesce(processed_at,now()),
      scheduled_at=null, processing_worker_id=null, processing_deadline_at=null, updated_at=now()
     where id=v_offer.id;
    return jsonb_build_object('status','ignored','reason','PILOT_DISABLED');
  end if;

  select count(*)::integer into v_destinations from public.automation_destinations
   where account_id=v_automation.account_id and automation_id=v_automation.id and enabled=true;
  if v_destinations = 0 then
    return public.create_pilot_offer_schedule_locked(v_offer.id, p_now);
  end if;

  -- Put every processed offer in the durable FIFO first. The promoter, under
  -- the same automation lock, assigns at most five physical future slots.
  update public.captured_offers
     set status='waiting', scheduled_at=null, error_code=null, error_message=null,
         processed_at=coalesce(processed_at,now()), processing_worker_id=null,
         processing_deadline_at=null, updated_at=now()
   where id=v_offer.id;
  perform public.promote_waiting_pilot_offers(v_automation.id, p_now);
  select jsonb_build_object('status', status, 'scheduled_at', scheduled_at,
           'destinations', case when status='scheduled' then v_destinations else 0 end,
           'already_scheduled', false)
    into v_result from public.captured_offers where id=v_offer.id;
  return v_result;
end;
$$;

revoke all on function public.schedule_pilot_offer(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.schedule_pilot_offer(uuid, text, timestamptz) to service_role;

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
  if nullif(trim(p_worker_id), '') is null or p_limit not between 1 and 100
     or p_processing_seconds not between 60 and 3600 then
    raise exception 'Parâmetros de recuperação inválidos.' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select offer.id
      from public.captured_offers offer
      join public.offer_automations automation
        on automation.id=offer.automation_id and automation.account_id=offer.account_id
       and automation.enabled=true and offer.captured_at >= automation.pilot_reset_at
      join public.accounts account_row on account_row.id=offer.account_id and account_row.status='active'
     where offer.status='processing'
       and offer.queue_quarantined_at is null
       and offer.error_code is distinct from 'PILOT_QUEUE_QUARANTINED'
       and not exists (select 1 from public.offer_deliveries delivery where delivery.offer_id=offer.id)
       and (offer.processing_deadline_at < now() or (
         offer.processing_deadline_at is null and offer.updated_at < now()-make_interval(secs=>p_processing_seconds)
       ))
     order by offer.captured_at,offer.id
     for update of offer skip locked limit p_limit
  )
  update public.captured_offers offer set processing_worker_id=p_worker_id,
    processing_deadline_at=now()+make_interval(secs=>p_processing_seconds),
    processing_attempts=offer.processing_attempts+1,error_code=null,error_message=null,updated_at=now()
   from candidates where offer.id=candidates.id
  returning offer.id,offer.account_id;
end;
$$;

revoke all on function public.claim_interrupted_pilot_offers(text, integer, integer)
  from public, anon, authenticated;

-- Promotion is triggered only after the old slot has no nonterminal delivery.
create or replace function public.promote_waiting_after_pilot_terminal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status in ('scheduled','sending')
     and new.status in ('sent','ignored','duplicate','processing_failed','send_failed')
     and not exists (
       select 1 from public.offer_deliveries delivery
        where delivery.offer_id=new.id
          and delivery.status in ('pending','scheduled','sending')
     ) then
    perform public.promote_waiting_pilot_offers(new.automation_id, now());
  end if;
  return new;
end;
$$;
revoke all on function public.promote_waiting_after_pilot_terminal()
  from public, anon, authenticated, service_role;
drop trigger if exists promote_waiting_after_pilot_terminal on public.captured_offers;
create trigger promote_waiting_after_pilot_terminal
after update of status on public.captured_offers
for each row when (old.status is distinct from new.status)
execute function public.promote_waiting_after_pilot_terminal();

-- One reset trigger replaces the two historical cancellation implementations.
drop trigger if exists stop_offer_automation_on_disable on public.offer_automations;
drop trigger if exists cancel_pilot_queue_when_disabled on public.offer_automations;
drop trigger if exists reset_pilot_schedule_when_disabled on public.offer_automations;

create or replace function public.reset_pilot_on_toggle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not (old.enabled is distinct from new.enabled) then return new; end if;
  update public.offer_automations
     set pilot_reset_at=now(),pilot_next_slot_at=null,updated_at=now()
   where id=new.id;
  if new.enabled then return new; end if;

  update public.affiliate_generation_jobs set status='expired',
    error_message='Piloto Automático desativado.',updated_at=now()
   where account_id=new.account_id and automation_id=new.id and status in ('pending','claimed');
  update public.captured_offer_links set conversion_status='failed',
    error_message='Piloto Automático desativado.',updated_at=now()
   where account_id=new.account_id and offer_id in (
     select id from public.captured_offers where account_id=new.account_id and automation_id=new.id
   ) and conversion_status in ('pending','resolving','generating','pending_reconnect');

  update public.envios_grupo dispatch set status='incerto', claim_token=null,
    processing_worker_id=null,processing_deadline_at=null,reconciliation_required=true,
    last_error_code='PILOT_DISABLED_DURING_SEND',
    erro='Piloto desativado durante envio; não reenviar automaticamente.',updated_at=now()
   where dispatch.account_id=new.account_id and dispatch.status='processando'
     and dispatch.id in (
       select delivery.group_dispatch_id from public.offer_deliveries delivery
       join public.captured_offers offer on offer.id=delivery.offer_id
       where offer.account_id=new.account_id and offer.automation_id=new.id
     );
  update public.envios_grupo dispatch set status='cancelado',claim_token=null,
    processing_worker_id=null,processing_deadline_at=null,
    erro='Piloto Automático desativado.',updated_at=now()
   where dispatch.account_id=new.account_id and dispatch.status in ('pendente','enfileirado','pausado')
     and dispatch.id in (
       select delivery.group_dispatch_id from public.offer_deliveries delivery
       join public.captured_offers offer on offer.id=delivery.offer_id
       where offer.account_id=new.account_id and offer.automation_id=new.id
     );
  update public.offer_deliveries delivery set status='uncertain',
    error_message='Piloto desativado durante envio; não reenviar automaticamente.',updated_at=now()
   where delivery.account_id=new.account_id and delivery.status='sending'
     and delivery.offer_id in (select id from public.captured_offers
       where account_id=new.account_id and automation_id=new.id);
  update public.offer_deliveries delivery set status='cancelled',
    error_message='Piloto Automático desativado.',updated_at=now()
   where delivery.account_id=new.account_id and delivery.status in ('pending','scheduled')
     and delivery.offer_id in (select id from public.captured_offers
       where account_id=new.account_id and automation_id=new.id);
  update public.captured_offers offer set status='ignored',error_code='PILOT_DISABLED',
    error_message='Piloto Automático desativado.',processed_at=coalesce(processed_at,now()),
    scheduled_at=null,processing_worker_id=null,processing_deadline_at=null,updated_at=now()
   where offer.account_id=new.account_id and offer.automation_id=new.id
     and offer.status in ('captured','processing','ready','waiting','scheduled','processing_failed','send_failed');
  update public.captured_offers offer set status='send_failed',
    error_code='PILOT_DISABLED_DURING_SEND_UNCERTAIN',
    error_message='Piloto desativado durante envio; revisão manual necessária.',
    processing_worker_id=null,processing_deadline_at=null,updated_at=now()
   where offer.account_id=new.account_id and offer.automation_id=new.id and offer.status='sending';
  return new;
end;
$$;
revoke all on function public.reset_pilot_on_toggle() from public,anon,authenticated,service_role;
drop trigger if exists reset_pilot_on_toggle on public.offer_automations;
create trigger reset_pilot_on_toggle after update of enabled on public.offer_automations
for each row when (old.enabled is distinct from new.enabled)
execute function public.reset_pilot_on_toggle();

-- Normalize only post-incident, wholly unsent overflow. The quarantined 6,339
-- are snapshotted and asserted byte-for-byte unchanged below.
create table if not exists public.pilot_waiting_normalization_audit (
  offer_id uuid primary key references public.captured_offers(id) on delete restrict,
  account_id uuid not null,
  automation_id uuid not null,
  prior_scheduled_at timestamptz,
  removed_dispatches integer not null,
  normalized_at timestamptz not null default now()
);
alter table public.pilot_waiting_normalization_audit enable row level security;

create temporary table pilot_quarantine_snapshot on commit drop as
select q.offer_id,to_jsonb(offer) row_before from public.pilot_queue_recovery_quarantine q
join public.captured_offers offer on offer.id=q.offer_id;

-- Serialize every active automation against the old and new scheduler.
select id from public.offer_automations where enabled for update;

create temporary table pilot_overflow on commit drop as
with ranked as (
  select offer.id,offer.account_id,offer.automation_id,offer.scheduled_at,
         row_number() over (partition by offer.automation_id order by
           case when offer.status='sending' then 0 else 1 end,
           offer.scheduled_at,offer.captured_at,offer.id) slot_number
    from public.captured_offers offer
   where offer.status in ('scheduled','sending')
     and not exists (select 1 from public.pilot_queue_recovery_quarantine q where q.offer_id=offer.id)
)
select ranked.* from ranked
 where slot_number>5
   and not exists (
     select 1 from public.offer_deliveries delivery
     left join public.envios_grupo dispatch on dispatch.id=delivery.group_dispatch_id
      where delivery.offer_id=ranked.id
        and (delivery.status in ('sent','uncertain','sending')
          or dispatch.status in ('sucesso','incerto','processando'))
   );

insert into public.pilot_waiting_normalization_audit(
  offer_id,account_id,automation_id,prior_scheduled_at,removed_dispatches
)
select overflow.id,overflow.account_id,overflow.automation_id,overflow.scheduled_at,
       count(delivery.id)::integer
  from pilot_overflow overflow left join public.offer_deliveries delivery on delivery.offer_id=overflow.id
 group by overflow.id,overflow.account_id,overflow.automation_id,overflow.scheduled_at;

create temporary table pilot_overflow_lots on commit drop as
select distinct dispatch.lote_id from pilot_overflow overflow
join public.offer_deliveries delivery on delivery.offer_id=overflow.id
join public.envios_grupo dispatch on dispatch.id=delivery.group_dispatch_id
where dispatch.lote_id is not null;

create temporary table pilot_overflow_dispatches on commit drop as
select dispatch.id from pilot_overflow overflow
join public.offer_deliveries delivery on delivery.offer_id=overflow.id
join public.envios_grupo dispatch on dispatch.id=delivery.group_dispatch_id;

delete from public.offer_deliveries delivery using pilot_overflow overflow
 where delivery.offer_id=overflow.id;
delete from public.envios_grupo dispatch using pilot_overflow_dispatches affected
 where dispatch.id=affected.id;
delete from public.envios_grupo_lotes batch using pilot_overflow_lots lot
 where batch.id=lot.lote_id
   and not exists(select 1 from public.envios_grupo dispatch where dispatch.lote_id=batch.id);
update public.captured_offers offer set status='waiting',scheduled_at=null,
  processing_worker_id=null,processing_deadline_at=null,error_code=null,error_message=null,updated_at=now()
 from pilot_overflow overflow where offer.id=overflow.id;

-- Recompute cursors from the five physical slots that remain.
update public.offer_automations automation set pilot_next_slot_at=counts.next_slot,updated_at=now()
from (
  select automation_inner.id,
    max(offer.scheduled_at) filter(where offer.status in ('scheduled','sending'))
      + make_interval(mins=>automation_inner.interval_minutes) next_slot
  from public.offer_automations automation_inner
  left join public.captured_offers offer on offer.automation_id=automation_inner.id
    and offer.account_id=automation_inner.account_id
  group by automation_inner.id,automation_inner.interval_minutes
) counts where automation.id=counts.id;

do $$
declare v_changed integer; v_over_limit integer; v_bad_waiting integer; v_incident integer;
begin
  select count(*) into v_changed from pilot_quarantine_snapshot snapshot
  join public.captured_offers offer on offer.id=snapshot.offer_id
  where to_jsonb(offer) is distinct from snapshot.row_before;
  select count(*) into v_over_limit from (
    select automation_id from public.captured_offers
     where status in ('scheduled','sending') group by automation_id having count(*)>5
  ) excess;
  select count(*) into v_bad_waiting from public.captured_offers offer
   where offer.status='waiting' and (offer.scheduled_at is not null
     or exists(select 1 from public.offer_deliveries delivery where delivery.offer_id=offer.id));
  select count(*) into v_incident from public.pilot_queue_recovery_quarantine;
  if v_changed<>0 or v_incident<>6339 then
    raise exception 'MIGRAÇÃO ABORTADA: conjunto antigo alterado (mudados %, auditados %).',v_changed,v_incident;
  end if;
  if v_over_limit<>0 or v_bad_waiting<>0 then
    raise exception 'MIGRAÇÃO ABORTADA: invariantes da fila falharam (acima de 5 %, waiting inválido %).',v_over_limit,v_bad_waiting;
  end if;
end;
$$;

-- Safe recovery is restored only after every new guard exists.
grant execute on function public.claim_interrupted_pilot_offers(text,integer,integer) to service_role;
insert into public.pilot_recovery_control_events(action,function_signature,affected_role,reason)
values('execute_restored','public.claim_interrupted_pilot_offers(text, integer, integer)','service_role',
  'Recuperação reativada após fila waiting, limite transacional de 5, reset boundary e exclusão explícita da quarentena.');

commit;
