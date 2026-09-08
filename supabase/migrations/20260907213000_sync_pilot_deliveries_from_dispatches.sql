begin;

-- envios_grupo is the source of truth for the WhatsApp queue. Keep the Pilot
-- delivery and offer aggregates consistent even when a dispatch is changed by
-- recovery, sender deletion, cancellation or manual reconciliation paths.
create or replace function public.sync_pilot_delivery_from_group_dispatch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected record;
  delivery_status text;
  delivery_count integer;
  sent_count integer;
  cancelled_count integer;
  terminal_count integer;
  sending_count integer;
  latest_sent_at timestamptz;
  offer_status text;
begin
  delivery_status := case new.status
    when 'pendente' then 'scheduled'
    when 'enfileirado' then 'scheduled'
    when 'pausado' then 'scheduled'
    when 'processando' then 'sending'
    when 'sucesso' then 'sent'
    when 'erro' then 'failed'
    when 'incerto' then 'uncertain'
    when 'cancelado' then 'cancelled'
    else null
  end;

  if delivery_status is null then
    return new;
  end if;

  update public.offer_deliveries delivery
     set status = delivery_status,
         error_message = case
           when delivery_status in ('failed', 'uncertain', 'cancelled') then new.erro
           else null
         end,
         sent_at = case
           when delivery_status = 'sent' then coalesce(new.sent_at, delivery.sent_at, now())
           else null
         end,
         updated_at = coalesce(new.updated_at, now())
   where delivery.group_dispatch_id = new.id
     and delivery.account_id = new.account_id;

  for affected in
    select distinct delivery.offer_id, delivery.account_id
      from public.offer_deliveries delivery
     where delivery.group_dispatch_id = new.id
       and delivery.account_id = new.account_id
  loop
    select count(*)::integer,
           count(*) filter (where status = 'sent')::integer,
           count(*) filter (where status = 'cancelled')::integer,
           count(*) filter (where status in ('sent', 'failed', 'uncertain', 'cancelled'))::integer,
           count(*) filter (where status = 'sending')::integer,
           max(sent_at) filter (where status = 'sent')
      into delivery_count, sent_count, cancelled_count, terminal_count, sending_count, latest_sent_at
      from public.offer_deliveries
     where offer_id = affected.offer_id
       and account_id = affected.account_id;

    offer_status := case
      when delivery_count > 0 and cancelled_count = delivery_count then 'ignored'
      when delivery_count > 0 and terminal_count = delivery_count and sent_count > 0 then 'sent'
      when delivery_count > 0 and terminal_count = delivery_count then 'send_failed'
      when sending_count > 0 then 'sending'
      else 'scheduled'
    end;

    update public.captured_offers offer
       set status = offer_status,
           sent_at = case
             when offer_status = 'sent' then coalesce(offer.sent_at, latest_sent_at, now())
             else offer.sent_at
           end,
           updated_at = now()
     where offer.id = affected.offer_id
       and offer.account_id = affected.account_id
       and offer.status is distinct from offer_status;
  end loop;

  return new;
end;
$$;

drop trigger if exists sync_pilot_delivery_from_group_dispatch on public.envios_grupo;
create trigger sync_pilot_delivery_from_group_dispatch
after update of status, erro, sent_at on public.envios_grupo
for each row
when (
  old.status is distinct from new.status
  or old.erro is distinct from new.erro
  or old.sent_at is distinct from new.sent_at
)
execute function public.sync_pilot_delivery_from_group_dispatch();

revoke all on function public.sync_pilot_delivery_from_group_dispatch() from public, anon, authenticated;

-- Repair active offers that were left behind before the trigger existed.
create temporary table pilot_offers_repaired on commit drop as
with repaired as (
  update public.offer_deliveries delivery
     set status = case dispatch.status
           when 'pendente' then 'scheduled'
           when 'enfileirado' then 'scheduled'
           when 'pausado' then 'scheduled'
           when 'processando' then 'sending'
           when 'sucesso' then 'sent'
           when 'erro' then 'failed'
           when 'incerto' then 'uncertain'
           when 'cancelado' then 'cancelled'
         end,
         error_message = case
           when dispatch.status in ('erro', 'incerto', 'cancelado') then dispatch.erro
           else null
         end,
         sent_at = case
           when dispatch.status = 'sucesso' then coalesce(dispatch.sent_at, delivery.sent_at, dispatch.updated_at)
           else null
         end,
         updated_at = now()
    from public.envios_grupo dispatch,
         public.captured_offers offer
   where delivery.group_dispatch_id = dispatch.id
     and delivery.offer_id = offer.id
     and delivery.account_id = dispatch.account_id
     and offer.account_id = delivery.account_id
     and offer.status in ('captured', 'processing', 'ready', 'scheduled', 'sending')
     and delivery.status is distinct from case dispatch.status
           when 'pendente' then 'scheduled'
           when 'enfileirado' then 'scheduled'
           when 'pausado' then 'scheduled'
           when 'processando' then 'sending'
           when 'sucesso' then 'sent'
           when 'erro' then 'failed'
           when 'incerto' then 'uncertain'
           when 'cancelado' then 'cancelled'
         end
  returning delivery.offer_id, delivery.account_id
)
select distinct offer_id, account_id from repaired;

create index on pilot_offers_repaired(offer_id, account_id);

with rollup as (
  select delivery.offer_id,
         delivery.account_id,
         count(*)::integer as delivery_count,
         count(*) filter (where delivery.status = 'sent')::integer as sent_count,
         count(*) filter (where delivery.status = 'cancelled')::integer as cancelled_count,
         count(*) filter (where delivery.status in ('sent', 'failed', 'uncertain', 'cancelled'))::integer as terminal_count,
         count(*) filter (where delivery.status = 'sending')::integer as sending_count,
         max(delivery.sent_at) filter (where delivery.status = 'sent') as latest_sent_at
    from public.offer_deliveries delivery
    join pilot_offers_repaired repaired
      on repaired.offer_id = delivery.offer_id
     and repaired.account_id = delivery.account_id
   group by delivery.offer_id, delivery.account_id
), resolved as (
  select rollup.*,
         case
           when cancelled_count = delivery_count then 'ignored'
           when terminal_count = delivery_count and sent_count > 0 then 'sent'
           when terminal_count = delivery_count then 'send_failed'
           when sending_count > 0 then 'sending'
           else 'scheduled'
         end as offer_status
    from rollup
)
update public.captured_offers offer
   set status = resolved.offer_status,
       sent_at = case
         when resolved.offer_status = 'sent' then coalesce(offer.sent_at, resolved.latest_sent_at, now())
         else offer.sent_at
       end,
       updated_at = now()
  from resolved
 where offer.id = resolved.offer_id
   and offer.account_id = resolved.account_id
   and offer.status is distinct from resolved.offer_status;

-- The status trigger normally maintains this counter. Recalculate it here as a
-- final invariant repair for each automation touched by the legacy mismatch.
update public.offer_automations automation
   set active_queue_count = counts.active_count,
       pilot_next_slot_at = counts.next_slot_at,
       updated_at = now()
  from (
    select automation_inner.id,
           count(offer.id) filter (
             where offer.status in ('captured', 'processing', 'ready', 'scheduled', 'sending')
           )::integer as active_count,
           max(offer.scheduled_at) filter (
             where offer.status in ('scheduled', 'sending')
           ) + make_interval(mins => automation_inner.interval_minutes) as next_slot_at
      from public.offer_automations automation_inner
      join (
        select distinct captured.automation_id
          from public.captured_offers captured
          join pilot_offers_repaired repaired
            on repaired.offer_id = captured.id
           and repaired.account_id = captured.account_id
      ) touched on touched.automation_id = automation_inner.id
      left join public.captured_offers offer
        on offer.automation_id = automation_inner.id
       and offer.account_id = automation_inner.account_id
     group by automation_inner.id, automation_inner.interval_minutes
  ) counts
 where automation.id = counts.id;

commit;
