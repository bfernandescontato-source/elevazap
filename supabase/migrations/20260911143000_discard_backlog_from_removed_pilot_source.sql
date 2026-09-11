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

  update public.envios_grupo dispatch
     set status='cancelado',claim_token=null,processing_worker_id=null,
         processing_deadline_at=null,erro='Grupo fonte removido da automação.',updated_at=now()
   where dispatch.account_id=p_account_id
     and dispatch.status in ('pendente','enfileirado','pausado')
     and dispatch.id in (
       select delivery.group_dispatch_id from public.offer_deliveries delivery
       join public.captured_offers offer on offer.id=delivery.offer_id
       where offer.account_id=p_account_id and offer.automation_id=p_automation_id
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

create or replace function public.discard_backlog_after_pilot_source_removed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.discard_pilot_source_backlog(old.account_id,old.automation_id,old.whatsapp_group_id);
  return old;
end;
$$;

revoke all on function public.discard_backlog_after_pilot_source_removed()
  from public,anon,authenticated,service_role;

drop trigger if exists discard_backlog_after_pilot_source_removed
  on public.automation_source_groups;
create trigger discard_backlog_after_pilot_source_removed
after delete on public.automation_source_groups
for each row execute function public.discard_backlog_after_pilot_source_removed();

commit;
