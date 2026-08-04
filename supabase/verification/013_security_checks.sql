-- Run manually after applying migration 013. This file is read-only.
-- Expected: no rows in either verification query.

select n.nspname as schema_name, p.proname as function_name, r.rolname as unexpected_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public'
  and p.proname in (
    'acquire_service_lock',
    'renew_service_lock',
    'increment_rate_limit',
    'claim_next_envio',
    'claim_next_envio_grupo',
    'clear_whatsapp_auth',
    'create_envio_from_webhook',
    'recalc_lote_counts',
    'create_campaign_atomic',
    'replace_campaign_groups_atomic',
    'create_group_lote_atomic',
    'transition_lote_atomic',
    'resolve_campaign_redirect',
    'get_campaign_redirect_metrics',
    'cleanup_campaign_operational_data'
  )
  and r.rolname in ('anon', 'authenticated')
  and has_function_privilege(r.rolname, p.oid, 'EXECUTE');

select n.nspname as schema_name, p.proname as function_name, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and p.proname in (
    'acquire_service_lock',
    'renew_service_lock',
    'increment_rate_limit',
    'claim_next_envio',
    'claim_next_envio_grupo',
    'clear_whatsapp_auth',
    'create_envio_from_webhook',
    'recalc_lote_counts',
    'create_campaign_atomic',
    'replace_campaign_groups_atomic',
    'create_group_lote_atomic',
    'transition_lote_atomic',
    'resolve_campaign_redirect',
    'get_campaign_redirect_metrics',
    'cleanup_campaign_operational_data'
  )
  and not coalesce(p.proconfig, '{}'::text[]) @> array['search_path=pg_catalog, public'];
