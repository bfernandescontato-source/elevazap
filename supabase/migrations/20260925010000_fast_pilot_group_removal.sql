-- Salvar o Piloto Automático tirando um grupo fonte ou destino estourava o limite
-- de 8 s da API ("canceling statement due to statement timeout") em contas grandes
-- (ex.: 147 mil envios_grupo numa conta só) e nada era salvo.
--
-- Causa: os gatilhos que limpam as pendências do grupo removido rodam dentro do
-- mesmo salvamento e procuravam os envios a cancelar varrendo TODO o histórico de
-- offer_deliveries da conta (sem filtrar status), só depois filtrando os envios
-- pendentes. Agora a busca parte só das entregas ainda pendentes/agendadas, que
-- são poucas, e há índices parciais para elas.
--
-- NÃO é aplicada automaticamente. Antes: rodar a verificação em transação desfeita
-- (supabase/verification/20260925010000_fast_pilot_group_removal.sql) e conferir o
-- esquema real. Os índices usam CONCURRENTLY (não travam escrita), por isso ficam
-- fora da transação e devem ser executados um por vez.

-- 1) Índices parciais: só linhas ainda pendentes (poucas), baratos de manter.
create index concurrently if not exists offer_deliveries_pending_offer_idx
  on public.offer_deliveries (offer_id)
  where status in ('pending', 'scheduled');

create index concurrently if not exists offer_deliveries_pending_destination_idx
  on public.offer_deliveries (account_id, destination_group_id)
  where status in ('pending', 'scheduled');

create index concurrently if not exists captured_offers_automation_source_idx
  on public.captured_offers (account_id, automation_id, source_group_id);

-- 2) Funções de limpeza com a busca a partir das entregas pendentes.
begin;

create or replace function public.discard_pilot_source_backlog(
  p_account_id uuid,
  p_automation_id uuid,
  p_source_group_id text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cancelled integer := 0;
begin
  perform 1 from public.offer_automations automation
   where automation.id=p_automation_id and automation.account_id=p_account_id
   for update;
  if not found then return 0; end if;

  -- Waiting work is made terminal first, so promotion cannot select another
  -- offer from the source that has just been removed.
  update public.captured_offers offer
     set status='ignored',error_code='PILOT_SOURCE_REMOVED',
         error_message='Grupo fonte removido da automação.',
         processed_at=coalesce(processed_at,now()),scheduled_at=null,
         processing_worker_id=null,processing_deadline_at=null,updated_at=now()
   where offer.account_id=p_account_id
     and offer.automation_id=p_automation_id
     and offer.source_type='whatsapp'
     and offer.source_group_id=p_source_group_id
     and offer.status in ('captured','processing','ready','waiting','processing_failed','send_failed');
  get diagnostics v_cancelled = row_count;

  update public.affiliate_generation_jobs job
     set status='expired',error_code='PILOT_SOURCE_REMOVED',
         error_message='Grupo fonte removido da automação.',updated_at=now()
   where job.account_id=p_account_id and job.status in ('pending','claimed')
     and job.offer_link_id in (
       select link.id from public.captured_offer_links link
       join public.captured_offers offer on offer.id=link.offer_id
       where offer.account_id=p_account_id and offer.automation_id=p_automation_id
         and offer.source_type='whatsapp' and offer.source_group_id=p_source_group_id
     );

  update public.captured_offer_links link
     set conversion_status='failed',conversion_error='Grupo fonte removido da automação.',updated_at=now()
   where link.account_id=p_account_id
     and link.conversion_status in ('pending','resolving','generating','pending_reconnect')
     and link.offer_id in (
       select offer.id from public.captured_offers offer
       where offer.account_id=p_account_id and offer.automation_id=p_automation_id
         and offer.source_type='whatsapp' and offer.source_group_id=p_source_group_id
     );

  -- Antes a subconsulta pegava todas as entregas do grupo (histórico inteiro).
  -- Um envio ainda cancelável sempre tem a entrega pendente/agendada.
  update public.envios_grupo dispatch
     set status='cancelado',claim_token=null,processing_worker_id=null,
         processing_deadline_at=null,erro='Grupo fonte removido da automação.',updated_at=now()
   where dispatch.account_id=p_account_id
     and dispatch.status in ('pendente','enfileirado','pausado')
     and dispatch.id in (
       select delivery.group_dispatch_id from public.offer_deliveries delivery
       join public.captured_offers offer on offer.id=delivery.offer_id
       where delivery.status in ('pending','scheduled')
         and offer.account_id=p_account_id and offer.automation_id=p_automation_id
         and offer.source_type='whatsapp' and offer.source_group_id=p_source_group_id
     );

  update public.offer_deliveries delivery
     set status='cancelled',error_message='Grupo fonte removido da automação.',updated_at=now()
   where delivery.account_id=p_account_id and delivery.status in ('pending','scheduled')
     and delivery.offer_id in (
       select offer.id from public.captured_offers offer
       where offer.account_id=p_account_id and offer.automation_id=p_automation_id
         and offer.source_type='whatsapp' and offer.source_group_id=p_source_group_id
     );

  with changed as (
    update public.captured_offers offer
       set status='ignored',error_code='PILOT_SOURCE_REMOVED',
           error_message='Grupo fonte removido da automação.',
           processed_at=coalesce(processed_at,now()),scheduled_at=null,
           processing_worker_id=null,processing_deadline_at=null,updated_at=now()
     where offer.account_id=p_account_id
       and offer.automation_id=p_automation_id
       and offer.source_type='whatsapp'
       and offer.source_group_id=p_source_group_id
       and offer.status='scheduled'
    returning 1
  )
  select v_cancelled + count(*)::integer into v_cancelled from changed;

  perform public.promote_waiting_pilot_offers(p_automation_id,now());
  return v_cancelled;
end;
$$;

revoke all on function public.discard_pilot_source_backlog(uuid,uuid,text)
  from public,anon,authenticated,service_role;

create or replace function public.cancel_pending_pilot_destination(
  p_account_id uuid,
  p_automation_id uuid,
  p_destination_group_id text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cancelled integer := 0;
  v_lote_id uuid;
begin
  perform 1 from public.offer_automations automation
   where automation.id=p_automation_id and automation.account_id=p_account_id
   for update;
  if not found then return 0; end if;

  create temporary table if not exists pilot_removed_destination_lotes(
    lote_id uuid primary key
  ) on commit drop;
  truncate pilot_removed_destination_lotes;

  insert into pilot_removed_destination_lotes(lote_id)
  select distinct dispatch.lote_id
    from public.offer_deliveries delivery
    join public.captured_offers offer on offer.id=delivery.offer_id
    join public.envios_grupo dispatch on dispatch.id=delivery.group_dispatch_id
   where delivery.account_id=p_account_id
     and delivery.destination_group_id=p_destination_group_id
     and delivery.status in ('pending','scheduled')
     and offer.automation_id=p_automation_id
     and dispatch.lote_id is not null
  on conflict do nothing;

  -- Antes a subconsulta pegava todas as entregas do destino (histórico inteiro).
  update public.envios_grupo dispatch
     set status='cancelado',claim_token=null,processing_worker_id=null,
         processing_deadline_at=null,erro='Grupo de destino removido da automação.',updated_at=now()
   where dispatch.account_id=p_account_id
     and dispatch.status in ('pendente','enfileirado','pausado')
     and dispatch.id in (
       select delivery.group_dispatch_id
         from public.offer_deliveries delivery
         join public.captured_offers offer on offer.id=delivery.offer_id
        where delivery.account_id=p_account_id
          and delivery.destination_group_id=p_destination_group_id
          and delivery.status in ('pending','scheduled')
          and offer.automation_id=p_automation_id
     );
  get diagnostics v_cancelled = row_count;

  update public.offer_deliveries delivery
     set status='cancelled',error_message='Grupo de destino removido da automação.',updated_at=now()
   where delivery.account_id=p_account_id
     and delivery.destination_group_id=p_destination_group_id
     and delivery.status in ('pending','scheduled')
     and delivery.offer_id in (
       select offer.id from public.captured_offers offer
        where offer.account_id=p_account_id and offer.automation_id=p_automation_id
     );

  for v_lote_id in select lote_id from pilot_removed_destination_lotes loop
    perform public.recalc_lote_counts(v_lote_id);
  end loop;

  perform public.promote_waiting_pilot_offers(p_automation_id,now());
  return v_cancelled;
end;
$$;

revoke all on function public.cancel_pending_pilot_destination(uuid,uuid,text)
  from public,anon,authenticated,service_role;

commit;
