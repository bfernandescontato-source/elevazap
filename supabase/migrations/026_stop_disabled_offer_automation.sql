begin;

create or replace function public.stop_disabled_offer_automation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not new.enabled then
    update public.affiliate_generation_jobs
       set status = 'expired', error_message = 'Piloto Automático desativado.', updated_at = now()
     where account_id = new.account_id
       and automation_id = new.id
       and status in ('pending', 'claimed');

    update public.captured_offer_links
       set conversion_status = 'failed', error_message = 'Piloto Automático desativado.', updated_at = now()
     where account_id = new.account_id
       and offer_id in (
         select id from public.captured_offers
          where account_id = new.account_id and automation_id = new.id
       )
       and conversion_status in ('pending', 'resolving', 'generating', 'pending_reconnect');

    update public.envios_grupo
       set status = 'cancelado', claim_token = null, processing_deadline_at = null,
           erro = 'Piloto Automático desativado.', updated_at = now()
     where account_id = new.account_id
       and status in ('pendente', 'enfileirado', 'processando')
       and id in (
         select delivery.group_dispatch_id
           from public.offer_deliveries delivery
           join public.captured_offers offer on offer.id = delivery.offer_id
          where offer.account_id = new.account_id
            and offer.automation_id = new.id
            and delivery.group_dispatch_id is not null
       );

    update public.offer_deliveries delivery
       set status = 'cancelled', error_message = 'Piloto Automático desativado.', updated_at = now()
     where delivery.account_id = new.account_id
       and delivery.status in ('pending', 'scheduled', 'sending')
       and delivery.offer_id in (
         select id from public.captured_offers
          where account_id = new.account_id and automation_id = new.id
       );

    update public.captured_offers
       set status = 'ignored', error_code = 'PILOT_DISABLED',
           error_message = 'Piloto Automático desativado.', processed_at = coalesce(processed_at, now()), updated_at = now()
     where account_id = new.account_id
       and automation_id = new.id
       and status in ('captured', 'processing', 'ready', 'scheduled', 'sending', 'processing_failed');

    update public.envios_grupo_lotes
       set status = 'cancelado', pendentes = 0, cancelados = total, updated_at = now()
     where account_id = new.account_id
       and status in ('pendente', 'processando', 'pausado')
       and id in (
         select distinct dispatch.lote_id
           from public.envios_grupo dispatch
           join public.offer_deliveries delivery on delivery.group_dispatch_id = dispatch.id
           join public.captured_offers offer on offer.id = delivery.offer_id
          where offer.account_id = new.account_id and offer.automation_id = new.id
       );
  end if;
  return new;
end;
$$;

drop trigger if exists stop_offer_automation_on_disable on public.offer_automations;
create trigger stop_offer_automation_on_disable
after update of enabled on public.offer_automations
for each row
when (new.enabled is false)
execute function public.stop_disabled_offer_automation();

commit;
