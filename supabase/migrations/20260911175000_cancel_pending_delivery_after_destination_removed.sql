begin;

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
   where offer.account_id=p_account_id
     and offer.automation_id=p_automation_id
     and delivery.destination_group_id=p_destination_group_id
     and delivery.status in ('pending','scheduled')
     and dispatch.lote_id is not null
  on conflict do nothing;

  update public.envios_grupo dispatch
     set status='cancelado',claim_token=null,processing_worker_id=null,
         processing_deadline_at=null,erro='Grupo de destino removido da automação.',updated_at=now()
   where dispatch.account_id=p_account_id
     and dispatch.status in ('pendente','enfileirado','pausado')
     and dispatch.id in (
       select delivery.group_dispatch_id
         from public.offer_deliveries delivery
         join public.captured_offers offer on offer.id=delivery.offer_id
        where offer.account_id=p_account_id
          and offer.automation_id=p_automation_id
          and delivery.destination_group_id=p_destination_group_id
     );
  get diagnostics v_cancelled = row_count;

  -- Covers legacy deliveries without a dispatch and keeps the visible state
  -- consistent even when no queue row needed an update.
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

create or replace function public.cancel_pending_after_pilot_destination_removed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.cancel_pending_pilot_destination(old.account_id,old.automation_id,old.whatsapp_group_id);
  return old;
end;
$$;

revoke all on function public.cancel_pending_after_pilot_destination_removed()
  from public,anon,authenticated,service_role;

drop trigger if exists cancel_pending_after_pilot_destination_removed
  on public.automation_destinations;
create trigger cancel_pending_after_pilot_destination_removed
after delete on public.automation_destinations
for each row execute function public.cancel_pending_after_pilot_destination_removed();

commit;
