begin;

-- Emergency containment for the 6,339 rows changed by the accidental recovery
-- in 20260908154038. This migration is deliberately fail-closed: every known
-- count and state is checked before the first incident-data update.

alter table public.captured_offers
  add column if not exists queue_recovered_at timestamptz,
  add column if not exists queue_recovery_previous_status text,
  add column if not exists queue_recovery_previous_error_code text,
  add column if not exists queue_quarantined_at timestamptz;

create table if not exists public.pilot_queue_recovery_quarantine (
  offer_id uuid primary key references public.captured_offers(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  automation_id uuid not null references public.offer_automations(id) on delete restrict,
  incident_source text not null check (incident_source in ('intact_marker', 'recovered_consumed')),
  original_status text not null,
  original_error_code text not null,
  state_before_containment text not null,
  error_before_containment text,
  migration_recovered_at timestamptz not null,
  captured_at timestamptz not null,
  sent_destinations_before integer not null,
  uncertain_destinations_before integer not null,
  active_dispatches_before integer not null,
  contained_at timestamptz not null default now()
);

alter table public.pilot_queue_recovery_quarantine enable row level security;

create table if not exists public.pilot_recovery_schedule_repairs (
  automation_id uuid primary key references public.offer_automations(id) on delete restrict,
  previous_next_slot_at timestamptz,
  repaired_next_slot_at timestamptz,
  repaired_at timestamptz not null default now(),
  reason text not null
);

alter table public.pilot_recovery_schedule_repairs enable row level security;

create temporary table pilot_legacy_untouched on commit drop as
select id, to_jsonb(offer) as row_before
  from public.captured_offers offer
 where id in (
   '8cac08ae-f654-4d30-928a-07fbcd5c86eb'::uuid,
   '42ae7ced-5132-4500-af7a-370041f502b4'::uuid
 );

create temporary table pilot_incident_offers (
  offer_id uuid primary key,
  account_id uuid not null,
  automation_id uuid not null,
  incident_source text not null,
  state_before_containment text not null,
  error_before_containment text,
  captured_at timestamptz not null
) on commit drop;

insert into pilot_incident_offers
select offer.id, offer.account_id, offer.automation_id,
       'intact_marker', offer.status, offer.error_code, offer.captured_at
  from public.captured_offers offer
 where offer.processing_deadline_at = '2026-09-08 16:07:37.637629+00'::timestamptz
   and offer.status = 'processing'
   and offer.processing_attempts = 0
   and offer.processing_worker_id is null
   and offer.scheduled_at is null
   and offer.updated_at = '2026-09-08 16:07:37.637629+00'::timestamptz
   and not exists (
     select 1 from public.offer_deliveries delivery where delivery.offer_id = offer.id
   );

insert into pilot_incident_offers
select offer.id, offer.account_id, offer.automation_id,
       'recovered_consumed', offer.status, offer.error_code, offer.captured_at
  from public.captured_offers offer
 where offer.created_at < '2026-09-08 16:07:37.637629+00'::timestamptz
   and offer.captured_at >= '2026-09-08 16:07:37.637629+00'::timestamptz - interval '24 hours'
   and offer.processing_attempts > 0
   and offer.updated_at >= '2026-09-08 16:07:37.637629+00'::timestamptz
   and offer.id not in (
     '8cac08ae-f654-4d30-928a-07fbcd5c86eb'::uuid,
     '42ae7ced-5132-4500-af7a-370041f502b4'::uuid
   );

-- Prevent any concurrent state transition while the assertions and updates run.
select offer.id
  from public.captured_offers offer
 where offer.id in (select incident.offer_id from pilot_incident_offers incident)
    or offer.id in (select legacy.id from pilot_legacy_untouched legacy)
 for update;

do $$
declare
  v_intact integer;
  v_consumed integer;
  v_total integer;
  v_legacy integer;
  v_active integer;
  v_success integer;
  v_uncertain integer;
  v_non_pending_active integer;
begin
  if has_function_privilege(
    'service_role',
    'public.claim_interrupted_pilot_offers(text, integer, integer)',
    'EXECUTE'
  ) then
    raise exception 'CONTENÇÃO ABORTADA: claim_interrupted_pilot_offers voltou a estar liberada.';
  end if;

  select count(*) filter (where incident_source = 'intact_marker'),
         count(*) filter (where incident_source = 'recovered_consumed'),
         count(*)
    into v_intact, v_consumed, v_total
    from pilot_incident_offers;
  select count(*) into v_legacy from pilot_legacy_untouched;

  select count(*) filter (where dispatch.status in ('pendente','enfileirado','processando','pausado')),
         count(*) filter (where dispatch.status = 'sucesso'),
         count(*) filter (where dispatch.status = 'incerto'),
         count(*) filter (
           where dispatch.status in ('enfileirado','processando','pausado')
         )
    into v_active, v_success, v_uncertain, v_non_pending_active
    from public.offer_deliveries delivery
    join public.envios_grupo dispatch on dispatch.id = delivery.group_dispatch_id
    join pilot_incident_offers incident on incident.offer_id = delivery.offer_id;

  if v_intact <> 6278 or v_consumed <> 61 or v_total <> 6339 then
    raise exception 'CONTENÇÃO ABORTADA: conjunto mudou (intactos %, consumidos %, total %).',
      v_intact, v_consumed, v_total;
  end if;
  if v_legacy <> 2 then
    raise exception 'CONTENÇÃO ABORTADA: esperados 2 processamentos antigos, encontrados %.', v_legacy;
  end if;
  if v_active <> 1272 or v_non_pending_active <> 0 then
    raise exception 'CONTENÇÃO ABORTADA: disparos ativos mudaram (ativos %, não-pendentes %).',
      v_active, v_non_pending_active;
  end if;
  if v_success <> 86 or v_uncertain <> 0 then
    raise exception 'CONTENÇÃO ABORTADA: resultados confirmados mudaram (sucesso %, incerto %).',
      v_success, v_uncertain;
  end if;

  raise notice 'Pré-contenção validada: 6278 intactos, 61 consumidos, 1272 pendentes, 86 sucessos, 0 incertos.';
end;
$$;

insert into public.pilot_queue_recovery_quarantine (
  offer_id, account_id, automation_id, incident_source,
  original_status, original_error_code, state_before_containment,
  error_before_containment, migration_recovered_at, captured_at,
  sent_destinations_before, uncertain_destinations_before,
  active_dispatches_before
)
select incident.offer_id, incident.account_id, incident.automation_id,
       incident.incident_source, 'ignored', 'PILOT_QUEUE_FULL',
       incident.state_before_containment, incident.error_before_containment,
       '2026-09-08 16:07:37.637629+00'::timestamptz, incident.captured_at,
       count(*) filter (where dispatch.status = 'sucesso')::integer,
       count(*) filter (where dispatch.status = 'incerto')::integer,
       count(*) filter (
         where dispatch.status in ('pendente','enfileirado','processando','pausado')
       )::integer
  from pilot_incident_offers incident
  left join public.offer_deliveries delivery on delivery.offer_id = incident.offer_id
  left join public.envios_grupo dispatch on dispatch.id = delivery.group_dispatch_id
 group by incident.offer_id, incident.account_id, incident.automation_id,
          incident.incident_source, incident.state_before_containment,
          incident.error_before_containment, incident.captured_at;

do $$
declare v_audited integer;
begin
  select count(*) into v_audited
    from public.pilot_queue_recovery_quarantine;
  if v_audited <> 6339 then
    raise exception 'CONTENÇÃO ABORTADA: auditoria gravou % de 6339 ofertas.', v_audited;
  end if;
end;
$$;

-- Snapshot the scheduling cursor before removing only the incident dispatches.
insert into public.pilot_recovery_schedule_repairs (
  automation_id, previous_next_slot_at, repaired_next_slot_at, reason
)
select automation.id, automation.pilot_next_slot_at, null,
       'Remoção do horizonte reservado pela recuperação acidental de 2026-09-08.'
  from public.offer_automations automation
  join (
    select distinct automation_id from pilot_incident_offers
  ) affected on affected.automation_id = automation.id;

-- Cancel only unsent dispatches belonging to the accidental set. Successful
-- and uncertain results are deliberately immutable here.
update public.envios_grupo dispatch
   set status = 'cancelado',
       claim_token = null,
       processing_worker_id = null,
       processing_deadline_at = null,
       erro = 'Cancelado por contenção da recuperação acidental PILOT_QUEUE_FULL.',
       updated_at = now()
  from public.offer_deliveries delivery
  join pilot_incident_offers incident on incident.offer_id = delivery.offer_id
 where delivery.group_dispatch_id = dispatch.id
   and dispatch.status = 'pendente';

do $$
declare v_cancelled integer;
begin
  select count(*) into v_cancelled
    from public.envios_grupo dispatch
    join public.offer_deliveries delivery on delivery.group_dispatch_id = dispatch.id
    join pilot_incident_offers incident on incident.offer_id = delivery.offer_id
   where dispatch.status = 'cancelado'
     and dispatch.erro = 'Cancelado por contenção da recuperação acidental PILOT_QUEUE_FULL.';
  if v_cancelled <> 1272 then
    raise exception 'CONTENÇÃO ABORTADA: cancelados % de 1272 disparos.', v_cancelled;
  end if;
end;
$$;

-- Recalculate only lots tied to the incident, preserving their sent/error history.
with affected_lots as (
  select distinct dispatch.lote_id
    from public.envios_grupo dispatch
    join public.offer_deliveries delivery on delivery.group_dispatch_id = dispatch.id
    join pilot_incident_offers incident on incident.offer_id = delivery.offer_id
   where dispatch.lote_id is not null
), counts as (
  select dispatch.lote_id,
         count(*)::integer total,
         count(*) filter (where dispatch.status = 'sucesso')::integer enviados,
         count(*) filter (where dispatch.status = 'erro')::integer erros,
         count(*) filter (where dispatch.status = 'cancelado')::integer cancelados,
         count(*) filter (where dispatch.status = 'pendente')::integer pendentes,
         count(*) filter (where dispatch.status = 'enfileirado')::integer enfileirados,
         count(*) filter (where dispatch.status = 'processando')::integer processando,
         count(*) filter (where dispatch.status = 'incerto')::integer incertos
    from public.envios_grupo dispatch
    join affected_lots affected on affected.lote_id = dispatch.lote_id
   group by dispatch.lote_id
)
update public.envios_grupo_lotes lot
   set status = case
         when counts.enviados = counts.total then 'sucesso'
         when counts.incertos > 0 then 'incerto'
         when counts.pendentes + counts.enfileirados + counts.processando = 0 then 'cancelado'
         else lot.status
       end,
       total = counts.total,
       enviados = counts.enviados,
       erros = counts.erros,
       pendentes = counts.pendentes,
       enfileirados = counts.enfileirados,
       processando = counts.processando,
       incertos = counts.incertos,
       finished_at = case
         when counts.pendentes + counts.enfileirados + counts.processando = 0
           then coalesce(lot.finished_at, now())
         else lot.finished_at
       end,
       updated_at = now()
  from counts
 where lot.id = counts.lote_id;

-- Only the 6,278 still-identifiable intact rows are changed to quarantine.
update public.captured_offers offer
   set status = 'ignored',
       error_code = 'PILOT_QUEUE_QUARANTINED',
       error_message = 'Oferta preservada em quarentena após recuperação acidental; processamento automático proibido.',
       processed_at = coalesce(offer.processed_at, now()),
       scheduled_at = null,
       processing_worker_id = null,
       processing_deadline_at = null,
       queue_recovered_at = '2026-09-08 16:07:37.637629+00'::timestamptz,
       queue_recovery_previous_status = 'ignored',
       queue_recovery_previous_error_code = 'PILOT_QUEUE_FULL',
       queue_quarantined_at = now(),
       updated_at = now()
  from pilot_incident_offers incident
 where offer.id = incident.offer_id
   and incident.incident_source = 'intact_marker';

do $$
declare v_quarantined integer;
begin
  select count(*) into v_quarantined
    from public.captured_offers offer
    join pilot_incident_offers incident on incident.offer_id = offer.id
   where incident.incident_source = 'intact_marker'
     and offer.status = 'ignored'
     and offer.error_code = 'PILOT_QUEUE_QUARANTINED';
  if v_quarantined <> 6278 then
    raise exception 'CONTENÇÃO ABORTADA: quarentenadas % de 6278 ofertas intactas.', v_quarantined;
  end if;
end;
$$;

-- Remove only the schedule horizon introduced by the accidental offers. Keep
-- any legitimate scheduled/sending offer (including the excluded legacy row)
-- as the basis for the repaired cursor.
with repaired as (
  select audit.automation_id,
         max(offer.scheduled_at) filter (
           where offer.status in ('scheduled', 'sending')
             and incident.offer_id is null
         ) + make_interval(mins => automation.interval_minutes) as next_slot_at
    from public.pilot_recovery_schedule_repairs audit
    join public.offer_automations automation on automation.id = audit.automation_id
    left join public.captured_offers offer
      on offer.automation_id = audit.automation_id
     and offer.account_id = automation.account_id
    left join pilot_incident_offers incident on incident.offer_id = offer.id
   group by audit.automation_id, automation.interval_minutes
)
update public.offer_automations automation
   set pilot_next_slot_at = repaired.next_slot_at,
       updated_at = now()
  from repaired
 where automation.id = repaired.automation_id;

update public.pilot_recovery_schedule_repairs audit
   set repaired_next_slot_at = automation.pilot_next_slot_at
  from public.offer_automations automation
 where automation.id = audit.automation_id;

do $$
declare
  v_audit_total integer;
  v_quarantined integer;
  v_marker_remaining integer;
  v_active_remaining integer;
  v_success integer;
  v_uncertain integer;
  v_legacy_changed integer;
begin
  select count(*) into v_audit_total from public.pilot_queue_recovery_quarantine;
  select count(*) into v_quarantined
    from public.pilot_queue_recovery_quarantine audit
    join public.captured_offers offer on offer.id = audit.offer_id
   where audit.incident_source = 'intact_marker'
     and offer.status = 'ignored'
     and offer.error_code = 'PILOT_QUEUE_QUARANTINED'
     and offer.processing_deadline_at is null
     and offer.processing_worker_id is null
     and offer.scheduled_at is null
     and not exists (
       select 1 from public.offer_deliveries delivery where delivery.offer_id = offer.id
     );
  select count(*) into v_marker_remaining
    from public.captured_offers
   where processing_deadline_at = '2026-09-08 16:07:37.637629+00'::timestamptz;
  select count(*) filter (where dispatch.status in ('pendente','enfileirado','processando','pausado')),
         count(*) filter (where dispatch.status = 'sucesso'),
         count(*) filter (where dispatch.status = 'incerto')
    into v_active_remaining, v_success, v_uncertain
    from public.offer_deliveries delivery
    join public.envios_grupo dispatch on dispatch.id = delivery.group_dispatch_id
    join public.pilot_queue_recovery_quarantine audit on audit.offer_id = delivery.offer_id;
  select count(*) into v_legacy_changed
    from pilot_legacy_untouched legacy
    join public.captured_offers offer on offer.id = legacy.id
   where to_jsonb(offer) is distinct from legacy.row_before;

  if v_audit_total <> 6339 or v_quarantined <> 6278 then
    raise exception 'CONTENÇÃO ABORTADA: pós-validação de auditoria/quarentena falhou (%, %).',
      v_audit_total, v_quarantined;
  end if;
  if v_marker_remaining <> 0 or v_active_remaining <> 0 then
    raise exception 'CONTENÇÃO ABORTADA: ainda há marcador/disparo ativo (%, %).',
      v_marker_remaining, v_active_remaining;
  end if;
  if v_success <> 86 or v_uncertain <> 0 then
    raise exception 'CONTENÇÃO ABORTADA: sucessos/incertos mudaram (%, %).', v_success, v_uncertain;
  end if;
  if v_legacy_changed <> 0 then
    raise exception 'CONTENÇÃO ABORTADA: % dos 2 processamentos antigos foram alterados.', v_legacy_changed;
  end if;
  if has_function_privilege(
    'service_role',
    'public.claim_interrupted_pilot_offers(text, integer, integer)',
    'EXECUTE'
  ) then
    raise exception 'CONTENÇÃO ABORTADA: recuperação foi reativada durante a transação.';
  end if;

  raise notice 'Contenção concluída: 6278 quarentenadas, 1272 pendentes cancelados, 86 sucessos preservados, 0 incertos, 2 legados intactos.';
end;
$$;

commit;
