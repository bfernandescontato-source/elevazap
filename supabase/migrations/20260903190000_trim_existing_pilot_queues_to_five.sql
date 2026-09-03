begin;

-- One-time reconciliation for queues created before the five-offer cap.
-- Dispatch is paused operationally before this migration is applied.
create temporary table pilot_offers_to_remove on commit drop as
with ranked as (
  select offer.id,
         row_number() over (
           partition by offer.automation_id
           order by
             case when offer.status = 'sending' then 0 else 1 end,
             offer.scheduled_at asc nulls last,
             offer.captured_at asc,
             offer.id
         ) as position
    from public.captured_offers offer
   where offer.status in ('captured', 'processing', 'ready', 'scheduled', 'sending')
)
select id from ranked where position > 5;

create index on pilot_offers_to_remove(id);

create temporary table pilot_lotes_affected on commit drop as
select distinct dispatch.lote_id
  from public.offer_deliveries delivery
  join pilot_offers_to_remove removed on removed.id = delivery.offer_id
  join public.envios_grupo dispatch on dispatch.id = delivery.group_dispatch_id
 where dispatch.lote_id is not null;

update public.envios_grupo dispatch
   set status = 'cancelado',
       claim_token = null,
       processing_deadline_at = null,
       erro = 'Removido para limitar a fila do Piloto a 5 ofertas.',
       updated_at = now()
  from public.offer_deliveries delivery
  join pilot_offers_to_remove removed on removed.id = delivery.offer_id
 where delivery.group_dispatch_id = dispatch.id
   and dispatch.status in ('pendente', 'enfileirado', 'pausado');

update public.offer_deliveries delivery
   set status = 'cancelled',
       error_message = 'Removida para limitar a fila a 5 ofertas.',
       updated_at = now()
  from pilot_offers_to_remove removed
 where delivery.offer_id = removed.id
   and delivery.status in ('pending', 'scheduled');

update public.captured_offers offer
   set status = 'ignored',
       error_code = 'PILOT_QUEUE_LIMIT_APPLIED',
       error_message = 'Removida para limitar a fila a 5 ofertas.',
       processed_at = coalesce(offer.processed_at, now()),
       updated_at = now()
  from pilot_offers_to_remove removed
 where offer.id = removed.id
   and offer.status in ('captured', 'processing', 'ready', 'scheduled');

update public.envios_grupo_lotes lote
   set total = counts.total,
       enviados = counts.enviados,
       erros = counts.erros,
       incertos = counts.incertos,
       processando = counts.processando,
       enfileirados = counts.enfileirados,
       pendentes = counts.pendentes,
       status = case
         when counts.pendentes + counts.enfileirados > 0 then 'pendente'
         when counts.processando > 0 then 'processando'
         when counts.incertos > 0 then 'incerto'
         when counts.enviados = counts.total and counts.total > 0 then 'sucesso'
         when counts.erros = counts.total and counts.total > 0 then 'erro'
         when counts.cancelados = counts.total and counts.total > 0 then 'cancelado'
         else 'concluido_com_erros'
       end,
       updated_at = now()
  from (
    select dispatch.lote_id,
           count(*)::integer as total,
           count(*) filter (where dispatch.status = 'sucesso')::integer as enviados,
           count(*) filter (where dispatch.status = 'erro')::integer as erros,
           count(*) filter (where dispatch.status = 'incerto')::integer as incertos,
           count(*) filter (where dispatch.status = 'processando')::integer as processando,
           count(*) filter (where dispatch.status = 'enfileirado')::integer as enfileirados,
           count(*) filter (where dispatch.status = 'pendente')::integer as pendentes,
           count(*) filter (where dispatch.status = 'cancelado')::integer as cancelados
      from public.envios_grupo dispatch
      join pilot_lotes_affected affected on affected.lote_id = dispatch.lote_id
     group by dispatch.lote_id
  ) counts
 where lote.id = counts.lote_id;

update public.offer_automations automation
   set active_queue_count = counts.active_count,
       pilot_next_slot_at = counts.next_slot,
       updated_at = now()
  from (
    select automation_inner.id,
           count(offer.id)::integer as active_count,
           max(offer.scheduled_at) filter (where offer.status = 'scheduled')
             + make_interval(mins => automation_inner.interval_minutes) as next_slot
      from public.offer_automations automation_inner
      left join public.captured_offers offer
        on offer.automation_id = automation_inner.id
       and offer.status in ('captured', 'processing', 'ready', 'scheduled', 'sending')
     group by automation_inner.id, automation_inner.interval_minutes
  ) counts
 where automation.id = counts.id;

commit;
