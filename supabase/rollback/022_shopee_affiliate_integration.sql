begin;
drop table if exists public.affiliate_link_cache;
drop table if exists public.affiliate_integrations;
drop index if exists public.captured_offers_item_dedup_idx;
drop index if exists public.captured_offers_conversion_idx;
alter table public.captured_offers drop constraint if exists captured_offers_affiliate_conversion_status_check;
update public.captured_offers set affiliate_conversion_status=case
  when affiliate_conversion_status='not_required' then 'not_enabled'
  when affiliate_conversion_status in ('resolving','generating') then 'pending'
  else affiliate_conversion_status end;
alter table public.captured_offers add constraint captured_offers_affiliate_conversion_status_check
  check (affiliate_conversion_status in ('not_enabled','pending','converted','failed'));
alter table public.captured_offers
  drop column if exists processed_text,
  drop column if exists affiliate_conversion_error,
  drop column if exists affiliate_conversion_attempts,
  drop column if exists affiliate_converted_at;
alter table public.offer_automations drop column if exists conversion_failure_policy;
commit;
