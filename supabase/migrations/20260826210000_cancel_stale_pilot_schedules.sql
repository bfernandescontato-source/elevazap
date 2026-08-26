-- Cancela apenas agendamentos do Piloto Automático que ficaram mais de sete dias
-- à frente. O histórico é preservado em todas as tabelas para auditoria.
begin;

with stale_dispatches as (
  select dispatch.id, dispatch.account_id, dispatch.lote_id
    from public.envios_grupo dispatch
    join public.offer_deliveries delivery on delivery.group_dispatch_id = dispatch.id
    join public.captured_offers offer on offer.id = delivery.offer_id
   where dispatch.status in ('pendente', 'enfileirado')
     and delivery.status in ('pending', 'scheduled')
     and offer.status = 'scheduled'
     and dispatch.scheduled_at > now() + interval '7 days'
), cancelled_dispatches as (
  update public.envios_grupo dispatch
     set status = 'cancelado',
         claim_token = null,
         processing_deadline_at = null,
         erro = 'Agendamento futuro inválido do Piloto Automático cancelado.',
         updated_at = now()
    from stale_dispatches stale
   where dispatch.id = stale.id and dispatch.account_id = stale.account_id
 returning dispatch.id
), cancelled_deliveries as (
  update public.offer_deliveries delivery
     set status = 'cancelled',
         error_message = 'Agendamento futuro inválido do Piloto Automático cancelado.',
         updated_at = now()
   where delivery.group_dispatch_id in (select id from cancelled_dispatches)
 returning delivery.offer_id
)
update public.captured_offers offer
   set status = 'ignored',
       error_code = 'STALE_FUTURE_SCHEDULE_CANCELLED',
       error_message = 'Agendamento futuro inválido do Piloto Automático cancelado.',
       processed_at = coalesce(offer.processed_at, now()),
       updated_at = now()
 where offer.id in (select distinct offer_id from cancelled_deliveries)
   and not exists (
     select 1 from public.offer_deliveries delivery
      where delivery.offer_id = offer.id
        and delivery.status in ('pending', 'scheduled', 'sending')
   );

update public.envios_grupo_lotes lote
   set pendentes = counts.pendentes,
       cancelados = counts.cancelados,
       status = case when counts.pendentes = 0 then 'cancelado' else lote.status end,
       updated_at = now()
  from (
    select dispatch.lote_id,
           count(*) filter (where dispatch.status in ('pendente', 'enfileirado', 'processando'))::integer as pendentes,
           count(*) filter (where dispatch.status = 'cancelado')::integer as cancelados
      from public.envios_grupo dispatch
     where dispatch.lote_id in (
       select distinct dispatch.lote_id
         from public.envios_grupo dispatch
         join public.offer_deliveries delivery on delivery.group_dispatch_id = dispatch.id
         join public.captured_offers offer on offer.id = delivery.offer_id
        where offer.error_code = 'STALE_FUTURE_SCHEDULE_CANCELLED'
     )
     group by dispatch.lote_id
  ) counts
 where lote.id = counts.lote_id;

commit;
