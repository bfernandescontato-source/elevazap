begin;

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

  update public.affiliate_generation_jobs job
     set status='expired',error_message='Piloto Automático desativado.',updated_at=now()
   where job.account_id=new.account_id
     and job.status in ('pending','claimed')
     and job.offer_link_id in (
       select link.id
         from public.captured_offer_links link
         join public.captured_offers offer on offer.id=link.offer_id
        where offer.account_id=new.account_id and offer.automation_id=new.id
     );
  update public.captured_offer_links link
     set conversion_status='failed',conversion_error='Piloto Automático desativado.',updated_at=now()
   where link.account_id=new.account_id
     and link.offer_id in (
       select id from public.captured_offers
        where account_id=new.account_id and automation_id=new.id
     )
     and link.conversion_status in ('pending','resolving','generating','pending_reconnect');

  update public.envios_grupo dispatch set status='incerto',claim_token=null,
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

revoke all on function public.reset_pilot_on_toggle()
  from public, anon, authenticated, service_role;

commit;
