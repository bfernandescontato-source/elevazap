-- Salvar o Piloto Automático tirando um grupo FONTE estourava o limite de 8 s da API
-- ("canceling statement due to statement timeout") em contas grandes e nada era salvo.
--
-- O gatilho que limpa o grupo fonte removido roda dentro do salvamento e cancelava os
-- envios das ofertas já agendadas varrendo o histórico de entregas da conta. Medido em
-- produção em 25/09/2026 (transação desfeita), conta com 147 mil envios:
--   tirar os grupos fonte: 17.700 ms antes -> 77 ms com esta versão.
-- Tirar grupo DESTINO já era rápido (11–46 ms) e não muda.
--
-- Mudança de comportamento (decidida com a usuária): as ofertas JÁ AGENDADAS do grupo
-- removido (no máximo 5 por automação) terminam de sair normalmente; só a fila que
-- ainda não virou envio é descartada, para o grupo novo não esperar ofertas velhas.
-- As funções de produção eram idênticas a 20260911143000/20260911175000 antes desta.

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
  v_ids uuid[];
begin
  perform 1 from public.offer_automations automation
   where automation.id=p_automation_id and automation.account_id=p_account_id
   for update;
  if not found then return 0; end if;

  -- Ofertas já agendadas (no máximo 5 por automação) terminam de sair normalmente:
  -- cancelar os envios delas para dezenas de grupos era o que estourava os 8 s do
  -- salvamento. Só a fila que ainda não virou envio é descartada, para o grupo novo
  -- não ficar esperando ofertas velhas do grupo removido.
  with discarded as (
    update public.captured_offers offer
       set status='ignored',error_code='PILOT_SOURCE_REMOVED',
           error_message='Grupo fonte removido da automação.',
           processed_at=coalesce(processed_at,now()),scheduled_at=null,
           processing_worker_id=null,processing_deadline_at=null,updated_at=now()
     where offer.account_id=p_account_id
       and offer.automation_id=p_automation_id
       and offer.source_type='whatsapp'
       and offer.source_group_id=p_source_group_id
       and offer.status in ('captured','processing','ready','waiting','processing_failed','send_failed')
    returning offer.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from discarded;

  if cardinality(v_ids) > 0 then
    update public.affiliate_generation_jobs job
       set status='expired',error_code='PILOT_SOURCE_REMOVED',
           error_message='Grupo fonte removido da automação.',updated_at=now()
     where job.account_id=p_account_id and job.status in ('pending','claimed')
       and job.offer_link_id in (
         select link.id from public.captured_offer_links link where link.offer_id = any(v_ids)
       );

    update public.captured_offer_links link
       set conversion_status='failed',conversion_error='Grupo fonte removido da automação.',updated_at=now()
     where link.offer_id = any(v_ids)
       and link.conversion_status in ('pending','resolving','generating','pending_reconnect');
  end if;

  perform public.promote_waiting_pilot_offers(p_automation_id,now());
  return cardinality(v_ids);
end;
$$;

revoke all on function public.discard_pilot_source_backlog(uuid,uuid,text)
  from public,anon,authenticated,service_role;

commit;
