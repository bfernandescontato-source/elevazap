begin;

-- Terminal compaction may remove gaps left by cancelled offers, but it must
-- never pull the next valid offer inside the configured interval after the
-- last successful send.
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
  v_last_sent_at timestamptz;
  v_lote_ids uuid[];
  v_scheduled integer := 0;
begin
  select * into v_automation
    from public.offer_automations
   where id = p_automation_id
   for update;
  if not found then return; end if;

  select max(offer.sent_at)
    into v_last_sent_at
    from public.captured_offers offer
   where offer.automation_id = v_automation.id
     and offer.account_id = v_automation.account_id
     and offer.status = 'sent'
     and offer.sent_at is not null;

  v_candidate := greatest(
    coalesce(p_floor_at, now()),
    now(),
    coalesce(v_last_sent_at + make_interval(mins => v_automation.interval_minutes), now())
  );

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

revoke all on function public.compact_pilot_schedule_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;

alter table public.captured_offers
  enable trigger compact_pilot_schedule_after_terminal_statement;

commit;
