-- Fix: resolve_campaign_redirect RPC did not include account_id when inserting
-- into campaign_redirect_events. Migration 015 added account_id NOT NULL to that
-- table, so every redirect either fails with a constraint violation (if the column
-- is NOT NULL in prod) or silently stores NULL (if the constraint was deferred).
-- Either way, the tenant-scoped API query (.eq("account_id", ...)) returns 0 rows,
-- so campaign group metrics always show zero.
--
-- Two-part fix:
--   1. Backfill existing events that have account_id IS NULL.
--   2. Recreate the RPC to always include account_id in the INSERT.

-- 1. Backfill: derive account_id from the parent campaign row.
update public.campaign_redirect_events e
set account_id = c.account_id
from public.campanhas c
where e.campaign_id = c.id
  and e.account_id is null;

-- 2. Recreate the RPC with account_id in the INSERT.
drop function if exists public.resolve_campaign_redirect(text, jsonb, text, text, text);
create function public.resolve_campaign_redirect(
  p_slug text,
  p_utm jsonb default '{}'::jsonb,
  p_user_agent text default null,
  p_anonymous_session_id text default null,
  p_rate_limit_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_campaign public.campanhas;
  selected_group public.campanha_grupos;
  target_url text;
  fallback_destination text;
  failure_reason text;
  source_name text;
  request_count integer;
  window_start timestamptz;
  expires_at timestamptz;
begin
  if p_slug is null or length(p_slug) not between 8 and 128 then
    return jsonb_build_object('ok', false, 'not_found', true);
  end if;

  select * into selected_campaign from public.campanhas where public_slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'not_found', true); end if;

  -- Rate limiting
  if p_rate_limit_key is not null then
    window_start := date_trunc('minute', now());
    expires_at := window_start + interval '2 minutes';
    insert into public.rate_limits(key, scope, count, window_start, expires_at, created_at, updated_at)
    values (left(p_rate_limit_key, 256), 'campaign_link:' || selected_campaign.id::text, 1, window_start, expires_at, now(), now())
    on conflict(key, scope, window_start) do update set count = public.rate_limits.count + 1, updated_at = now()
    returning count into request_count;
    if request_count > selected_campaign.public_rate_limit_per_minute then
      return jsonb_build_object('ok', false, 'rate_limited', true, 'reason', 'muitas_tentativas');
    end if;
  end if;

  update public.campanhas set total_accesses = total_accesses + 1, updated_at = now()
  where id = selected_campaign.id;

  fallback_destination := case
    when selected_campaign.fallback_type = 'url' then selected_campaign.fallback_url
    else null
  end;

  -- Determine failure reason if campaign is not accepting traffic
  if selected_campaign.status <> 'ativa' then
    failure_reason := case when selected_campaign.status = 'pausada' then 'campanha_pausada' else 'campanha_encerrada' end;
  elsif not selected_campaign.link_ativo then
    failure_reason := 'link_pausado';
  end if;

  -- Find the best available group
  if failure_reason is null then
    select cg.* into selected_group
    from public.campanha_grupos cg
    where cg.campanha_id = selected_campaign.id
      and cg.manual_status = 'disponivel'
      and cg.invite_url like 'https://chat.whatsapp.com/%'
      and cg.participant_count is not null
      and cg.participants_synced_at is not null
      and (
        cg.participants_synced_at >= now() - make_interval(secs => selected_campaign.participant_data_max_age_seconds)
        or (
          selected_campaign.allow_stale_participant_count
          and cg.participants_synced_at >= now() - make_interval(secs => selected_campaign.participant_data_max_age_seconds + selected_campaign.participant_data_stale_grace_seconds)
        )
      )
      and (selected_campaign.reuse_available_groups or cg.capacity_reached_at is null)
      and (
        cg.participant_limit is null
        or cg.participant_count < greatest(0,
            cg.participant_limit - cg.safety_margin
            - case
                when cg.participants_synced_at < now() - make_interval(secs => selected_campaign.participant_data_max_age_seconds)
                then selected_campaign.stale_participant_safety_margin
                else 0
              end
          )
      )
    order by cg.position asc
    limit 1;

    if found then
      target_url := selected_group.invite_url;
      update public.campanha_grupos
      set redirection_count = redirection_count + 1, updated_at = now()
      where campanha_id = selected_campaign.id and group_jid = selected_group.group_jid;
      update public.campanhas set total_redirects = total_redirects + 1, updated_at = now()
      where id = selected_campaign.id;
    else
      failure_reason := 'nenhum_grupo_confiavel';
    end if;
  end if;

  source_name := coalesce(nullif(coalesce(p_utm, '{}'::jsonb)->>'utm_source', ''), 'Sem UTM');

  -- Insert event — account_id is now included so tenant-scoped queries return results
  insert into public.campaign_redirect_events(
    account_id, campaign_id, group_jid, result, reason,
    utm, user_agent, anonymous_session_id, destination_url
  )
  values (
    selected_campaign.account_id,
    selected_campaign.id,
    selected_group.group_jid,
    case when target_url is not null then 'redirecionado' else 'sem_redirecionamento' end,
    failure_reason,
    coalesce(p_utm, '{}'::jsonb),
    left(p_user_agent, 500),
    left(p_anonymous_session_id, 200),
    coalesce(target_url, fallback_destination)
  );

  insert into public.campaign_redirect_daily_metrics(campaign_id, day, source, result, total)
  values (
    selected_campaign.id,
    current_date,
    source_name,
    case when target_url is not null then 'redirecionado' else 'sem_redirecionamento' end,
    1
  )
  on conflict(campaign_id, day, source, result) do update
    set total = public.campaign_redirect_daily_metrics.total + 1;

  if target_url is not null then
    return jsonb_build_object(
      'ok', true,
      'destination_url', target_url,
      'campaign_id', selected_campaign.id,
      'group_jid', selected_group.group_jid
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'campaign_id', selected_campaign.id,
    'reason', failure_reason,
    'fallback_url', fallback_destination
  );
end;
$$;

revoke all on function public.resolve_campaign_redirect(text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_campaign_redirect(text, jsonb, text, text, text) to service_role;
