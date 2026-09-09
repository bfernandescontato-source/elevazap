begin;

-- Rebuild the small physical queue whenever a slot becomes terminal. This
-- prevents cancelled/failed offers from leaving pilot_next_slot_at (and the
-- remaining pending jobs) many hours or days ahead. Waiting offers may already
-- have been promoted by the row-level trigger; this statement-level trigger
-- compacts the final set once per UPDATE statement.
create or replace function public.compact_pilot_schedule_locked(
  p_automation_id uuid,
  p_floor_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_automation public.offer_automations;
  v_offer record;
  v_slot timestamptz;
  v_local timestamp;
  v_candidate timestamptz;
  v_lote_ids uuid[];
  v_scheduled integer := 0;
begin
  select * into v_automation
    from public.offer_automations
   where id = p_automation_id
   for update;
  if not found then return; end if;

  v_candidate := greatest(coalesce(p_floor_at, now()), now());

  for v_offer in
    select offer.id
      from public.captured_offers offer
     where offer.automation_id = v_automation.id
       and offer.account_id = v_automation.account_id
       and offer.status = 'scheduled'
     order by offer.scheduled_at nulls last, offer.captured_at, offer.id
     for update
  loop
    v_local := v_candidate at time zone v_automation.timezone;
    if v_local::time < v_automation.operating_start then
      v_slot := (v_local::date + v_automation.operating_start) at time zone v_automation.timezone;
    elsif v_local::time > v_automation.operating_end then
      v_slot := ((v_local::date + 1) + v_automation.operating_start) at time zone v_automation.timezone;
    else
      v_slot := v_candidate;
    end if;

    select array_agg(distinct dispatch.lote_id)
      into v_lote_ids
      from public.offer_deliveries delivery
      join public.envios_grupo dispatch on dispatch.id = delivery.group_dispatch_id
     where delivery.offer_id = v_offer.id
       and delivery.account_id = v_automation.account_id
       and dispatch.lote_id is not null;

    update public.envios_grupo dispatch
       set scheduled_at = v_slot,
           next_attempt_at = null,
           updated_at = now()
     where dispatch.account_id = v_automation.account_id
       and dispatch.status = 'pendente'
       and dispatch.id in (
         select delivery.group_dispatch_id
           from public.offer_deliveries delivery
          where delivery.offer_id = v_offer.id
            and delivery.account_id = v_automation.account_id
            and delivery.group_dispatch_id is not null
       );

    update public.envios_grupo_lotes lote
       set scheduled_at = v_slot,
           updated_at = now()
     where lote.account_id = v_automation.account_id
       and lote.status = 'pendente'
       and lote.id = any(coalesce(v_lote_ids, '{}'::uuid[]));

    update public.offer_deliveries delivery
       set scheduled_at = v_slot,
           updated_at = now()
     where delivery.offer_id = v_offer.id
       and delivery.account_id = v_automation.account_id
       and delivery.status = 'scheduled';

    update public.captured_offers offer
       set scheduled_at = v_slot,
           updated_at = now()
     where offer.id = v_offer.id
       and offer.account_id = v_automation.account_id
       and offer.status = 'scheduled';

    v_scheduled := v_scheduled + 1;
    v_candidate := v_slot + make_interval(mins => v_automation.interval_minutes);
  end loop;

  update public.offer_automations automation
     set pilot_next_slot_at = case when v_scheduled = 0 then null else v_candidate end,
         updated_at = now()
   where automation.id = v_automation.id;
end;
$$;

create or replace function public.compact_pilot_schedule_after_terminal_statement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_automation record;
begin
  for v_automation in
    select distinct new_offer.automation_id
      from old_pilot_offers old_offer
      join new_pilot_offers new_offer on new_offer.id = old_offer.id
     where old_offer.status in ('scheduled', 'sending')
       and new_offer.status in ('sent', 'ignored', 'duplicate', 'processing_failed', 'send_failed')
       and old_offer.status is distinct from new_offer.status
  loop
    perform public.compact_pilot_schedule_locked(v_automation.automation_id, now());
  end loop;
  return null;
end;
$$;

revoke all on function public.compact_pilot_schedule_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.compact_pilot_schedule_after_terminal_statement()
  from public, anon, authenticated, service_role;

drop trigger if exists compact_pilot_schedule_after_terminal_statement
  on public.captured_offers;
create trigger compact_pilot_schedule_after_terminal_statement
after update on public.captured_offers
referencing old table as old_pilot_offers new table as new_pilot_offers
for each statement
execute function public.compact_pilot_schedule_after_terminal_statement();

commit;
