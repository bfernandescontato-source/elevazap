-- O limite de grupos fonte do Piloto vem de accounts.max_source_groups (era um 2 fixo
-- em save_offer_autopilot_configuration: o painel aceitava 5 e o banco recusava com
-- "Máximo de 2 grupos fonte"). Aplicada em produção em 29/09/2026.
CREATE OR REPLACE FUNCTION public.save_offer_autopilot_configuration(p_account_id uuid, p_input jsonb)
 RETURNS offer_automations
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  automation public.offer_automations;
  source_ids text[];
  max_sources integer;
  destination_ids text[];
  requested_ids text[];
  previous_source_ids text[];
  previous_destination_ids text[];
  sender_id uuid;
begin
  sender_id := (p_input->>'whatsapp_sender_id')::uuid;

  select coalesce(array_agg(distinct value), '{}'::text[])
    into source_ids
    from jsonb_array_elements_text(coalesce(p_input->'source_group_ids', '[]'::jsonb));
  select coalesce(array_agg(distinct value), '{}'::text[])
    into destination_ids
    from jsonb_array_elements_text(coalesce(p_input->'destination_group_ids', '[]'::jsonb));
  requested_ids := source_ids || destination_ids;

  if not exists (
    select 1 from public.whatsapp_senders
     where id = sender_id and account_id = p_account_id
  ) then raise exception 'Número responsável não pertence à sua conta.'; end if;

  if coalesce((p_input->>'enabled')::boolean, false) and cardinality(source_ids) = 0 then
    raise exception 'Escolha ao menos um grupo fonte.';
  end if;
  -- Limite por conta (accounts.max_source_groups; 5 para todos desde 28/09/2026).
  -- Era um 2 fixo aqui: o painel liberava 5 e o banco recusava o salvamento.
  select coalesce((select max_source_groups from public.accounts where id = p_account_id), 5) into max_sources;
  if cardinality(source_ids) > max_sources then
    raise exception 'Máximo de % grupos fonte por automação.', max_sources;
  end if;
  if coalesce((p_input->>'enabled')::boolean, false) and cardinality(destination_ids) = 0 then
    raise exception 'Escolha ao menos um grupo de destino.';
  end if;
  if exists (
    select 1 from unnest(requested_ids) requested(group_id)
     where group_id not like '%@g.us'
        or not exists (
          select 1 from public.whatsapp_sender_grupos sender_group
           where sender_group.account_id = p_account_id
             and sender_group.whatsapp_sender_id = sender_id
             and sender_group.group_jid = requested.group_id
        )
  ) then raise exception 'Um ou mais grupos não são acessíveis pelo número selecionado.'; end if;

  insert into public.offer_automations (
    account_id, created_by, whatsapp_sender_id, enabled, interval_minutes,
    operating_start, operating_end, timezone, keep_original_text,
    keep_original_media, avoid_duplicates, ai_rewrite_enabled,
    shopee_conversion_enabled, mercado_livre_conversion_enabled,
    conversion_failure_policy, updated_at
  ) values (
    p_account_id, auth.uid(), sender_id, (p_input->>'enabled')::boolean,
    (p_input->>'interval_minutes')::integer, (p_input->>'operating_start')::time,
    (p_input->>'operating_end')::time, p_input->>'timezone',
    (p_input->>'keep_original_text')::boolean, (p_input->>'keep_original_media')::boolean,
    (p_input->>'avoid_duplicates')::boolean, (p_input->>'ai_rewrite_enabled')::boolean,
    (p_input->>'shopee_conversion_enabled')::boolean,
    (p_input->>'mercado_livre_conversion_enabled')::boolean,
    p_input->>'conversion_failure_policy', now()
  )
  on conflict (account_id) do update set
    whatsapp_sender_id = excluded.whatsapp_sender_id,
    enabled = excluded.enabled,
    interval_minutes = excluded.interval_minutes,
    operating_start = excluded.operating_start,
    operating_end = excluded.operating_end,
    timezone = excluded.timezone,
    keep_original_text = excluded.keep_original_text,
    keep_original_media = excluded.keep_original_media,
    avoid_duplicates = excluded.avoid_duplicates,
    ai_rewrite_enabled = excluded.ai_rewrite_enabled,
    shopee_conversion_enabled = excluded.shopee_conversion_enabled,
    mercado_livre_conversion_enabled = excluded.mercado_livre_conversion_enabled,
    conversion_failure_policy = excluded.conversion_failure_policy,
    updated_at = now()
  returning * into automation;

  select coalesce(array_agg(whatsapp_group_id), '{}'::text[])
    into previous_source_ids
    from public.automation_source_groups
   where account_id = p_account_id and automation_id = automation.id and enabled = true;
  select coalesce(array_agg(whatsapp_group_id), '{}'::text[])
    into previous_destination_ids
    from public.automation_destinations
   where account_id = p_account_id and automation_id = automation.id and enabled = true;

  delete from public.automation_source_groups
   where account_id = p_account_id and automation_id = automation.id
     and not (whatsapp_group_id = any(source_ids));
  insert into public.automation_source_groups (
    account_id, automation_id, whatsapp_group_id, priority, enabled, updated_at
  )
  select p_account_id, automation.id, group_id, ordinal - 1, true, now()
    from unnest(source_ids) with ordinality selected(group_id, ordinal)
  on conflict (automation_id, whatsapp_group_id) do update
    set enabled = true, priority = excluded.priority, updated_at = now();

  delete from public.automation_destinations
   where account_id = p_account_id and automation_id = automation.id
     and not (whatsapp_group_id = any(destination_ids));
  insert into public.automation_destinations (
    account_id, automation_id, whatsapp_group_id, enabled
  )
  select p_account_id, automation.id, group_id, true
    from unnest(destination_ids) selected(group_id)
  on conflict (automation_id, whatsapp_group_id) do update set enabled = true;

  insert into public.offer_automation_config_events (
    account_id, automation_id, changed_by,
    source_groups_added, source_groups_removed,
    destination_groups_added, destination_groups_removed
  ) values (
    p_account_id, automation.id, auth.uid(),
    to_jsonb(array(select unnest(source_ids) except select unnest(previous_source_ids))),
    to_jsonb(array(select unnest(previous_source_ids) except select unnest(source_ids))),
    to_jsonb(array(select unnest(destination_ids) except select unnest(previous_destination_ids))),
    to_jsonb(array(select unnest(previous_destination_ids) except select unnest(destination_ids)))
  );

  return automation;
end;
$function$
;
