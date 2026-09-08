-- Read-only checks after applying 20260908154038_preserve_pilot_backlog.sql
-- Expected result is documented above each query.

-- Expected: one row, both functions present, legacy counter absent.
select
  to_regprocedure('public.claim_interrupted_pilot_offers(text,integer,integer)') is not null as recovery_function_present,
  to_regprocedure('public.schedule_pilot_offer(uuid,text,timestamp with time zone)') is not null as atomic_scheduler_present,
  not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'offer_automations'
       and column_name = 'active_queue_count'
  ) as legacy_counter_absent;

-- Expected: zero rows. Run again at least 15 minutes after deployment.
select id, account_id, automation_id, captured_at, updated_at
  from public.captured_offers
 where error_code = 'PILOT_QUEUE_FULL'
   and created_at >= now() - interval '15 minutes'
 order by created_at desc;

-- Expected: zero rows. Expired processing rows should be reclaimed in <= 1 minute.
select id, account_id, automation_id, processing_worker_id,
       processing_deadline_at, processing_attempts
  from public.captured_offers
 where status = 'processing'
   and processing_deadline_at < now() - interval '2 minutes'
 order by processing_deadline_at;

-- Expected: zero rows. Each offer/destination and each dispatch key is unique.
select 'offer_delivery' as invariant, offer_id::text as owner, destination_group_id as duplicate_key, count(*)
  from public.offer_deliveries
 group by offer_id, destination_group_id
having count(*) > 1
union all
select 'group_dispatch', account_id::text, idempotency_key, count(*)
  from public.envios_grupo
 where idempotency_key like 'pilot:%'
 group by account_id, idempotency_key
having count(*) > 1;

-- Expected: zero rows. An offer declared scheduled/sending/sent must have delivery rows.
select offer.id, offer.account_id, offer.status, offer.scheduled_at
  from public.captured_offers offer
 where offer.status in ('scheduled', 'sending', 'sent')
   and not exists (
     select 1 from public.offer_deliveries delivery
      where delivery.offer_id = offer.id
        and delivery.account_id = offer.account_id
   );

-- Expected: zero rows. Consecutive scheduled offers must respect the configured interval.
with ordered as (
  select offer.id, offer.account_id, offer.automation_id, offer.scheduled_at,
         automation.interval_minutes,
         lag(offer.scheduled_at) over (
           partition by offer.account_id, offer.automation_id
           order by offer.scheduled_at, offer.id
         ) as previous_scheduled_at
    from public.captured_offers offer
    join public.offer_automations automation
      on automation.id = offer.automation_id
     and automation.account_id = offer.account_id
   where offer.scheduled_at is not null
     and offer.status in ('scheduled', 'sending', 'sent')
     and offer.created_at >= now() - interval '24 hours'
)
select *
  from ordered
 where previous_scheduled_at is not null
   and scheduled_at < previous_scheduled_at + make_interval(mins => interval_minutes);

-- Focused operational view for the two reported accounts.
select app.email, account_row.status as account_status, automation.enabled,
       automation.interval_minutes, sender.session_name, sender.connection_status,
       offer.status as offer_status, offer.error_code, offer.captured_at,
       offer.scheduled_at, offer.sent_at, offer.processing_attempts
  from public.app_users app
  join public.accounts account_row on account_row.id = app.account_id
  left join public.offer_automations automation on automation.account_id = app.account_id
  left join public.whatsapp_senders sender on sender.id = automation.whatsapp_sender_id
  left join public.captured_offers offer on offer.account_id = app.account_id
 where lower(app.email) in (
   'rosikellyconceicaocruz@gmail.com',
   'thvictor@live.com'
 )
   and (offer.id is null or offer.captured_at >= now() - interval '48 hours')
 order by app.email, offer.captured_at desc;

-- Cross-account status overview. Use this to spot a regression affecting others.
select offer.status, coalesce(offer.error_code, 'NONE') as error_code, count(*)
  from public.captured_offers offer
 where offer.created_at >= now() - interval '24 hours'
 group by offer.status, coalesce(offer.error_code, 'NONE')
 order by offer.status, error_code;
