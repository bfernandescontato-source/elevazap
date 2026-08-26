begin;

-- A disable is a permanent operational boundary for the current Pilot queue.
-- Reactivating the automation never revives these rows; only new offers may run.
create or replace function public.cancel_pilot_queue_on_disable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not (old.enabled is distinct from new.enabled and new.enabled is false) then
    return new;
  end if;

  update public.envios_grupo dispatch
     set status = 'cancelado',
         claim_token = null,
         processing_deadline_at = null,
         erro = 'Piloto Automático desativado.',
         updated_at = now()
    from public.offer_deliveries delivery
    join public.captured_offers offer on offer.id = delivery.offer_id
   where delivery.group_dispatch_id = dispatch.id
     and dispatch.account_id = new.account_id
     and offer.account_id = new.account_id
     and offer.automation_id = new.id
     and dispatch.status in ('pendente', 'enfileirado', 'pausado');

  update public.offer_deliveries delivery
     set status = 'cancelled',
         error_message = 'Piloto Automático desativado.',
         updated_at = now()
    from public.captured_offers offer
   where offer.id = delivery.offer_id
     and offer.account_id = new.account_id
     and offer.automation_id = new.id
     and delivery.status in ('pending', 'scheduled');

  update public.captured_offers offer
     set status = 'ignored',
         error_code = 'PILOT_DISABLED',
         error_message = 'Piloto Automático desativado.',
         processed_at = coalesce(offer.processed_at, now()),
         updated_at = now()
   where offer.account_id = new.account_id
     and offer.automation_id = new.id
     and offer.status in ('captured', 'processing', 'ready', 'scheduled', 'processing_failed', 'send_failed');

  return new;
end;
$$;

drop trigger if exists cancel_pilot_queue_when_disabled on public.offer_automations;
create trigger cancel_pilot_queue_when_disabled
after update of enabled on public.offer_automations
for each row
execute function public.cancel_pilot_queue_on_disable();

revoke all on function public.cancel_pilot_queue_on_disable() from public, anon, authenticated;
grant execute on function public.cancel_pilot_queue_on_disable() to service_role;

commit;
