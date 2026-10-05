-- Piloto: botão "Enviar assim que chegar".
--
-- Ligado, a oferta sai assim que é convertida, sem esperar o intervalo da conta.
-- Fica uma pausa mínima de 1 minuto entre ofertas para proteger o número de
-- bloqueio do WhatsApp quando o grupo fonte posta muito. Desligado, nada muda.
-- Painel antigo (sem o campo) não desliga o botão ao salvar: o valor só muda
-- quando a entrada traz send_immediately.

alter table public.offer_automations
  add column if not exists send_immediately boolean not null default false;

create or replace function public.pilot_send_interval(p_automation public.offer_automations)
 returns interval
 language sql
 immutable
 set search_path to 'pg_catalog', 'public'
as $$
  select case when p_automation.send_immediately then interval '1 minute'
              else make_interval(mins => p_automation.interval_minutes) end
$$;

CREATE OR REPLACE FUNCTION public.create_pilot_offer_schedule_locked(p_offer_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_offer public.captured_offers;
  v_automation public.offer_automations;
  v_sender public.whatsapp_senders;
  v_lote_id uuid;
  v_destination_count integer;
  v_base_at timestamptz;
  v_local_base timestamp;
  v_scheduled_local timestamp;
  v_scheduled_at timestamptz;
  v_message_type text;
  v_message_text text;
  v_effective_now timestamptz;
begin
  select * into v_offer from public.captured_offers where id = p_offer_id;
  if not found then
    raise exception 'Oferta não encontrada.' using errcode = 'P0002';
  end if;
  if v_offer.status not in ('processing', 'ready', 'waiting') then
    raise exception 'Oferta não está pronta para agendamento.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.offer_deliveries where offer_id = v_offer.id) then
    raise exception 'Oferta em espera já possui entregas.' using errcode = '23505';
  end if;

  select * into v_automation
    from public.offer_automations
   where id = v_offer.automation_id and account_id = v_offer.account_id;
  if not found then raise exception 'Automação não encontrada.' using errcode = 'P0002'; end if;
  if not v_automation.enabled or v_offer.captured_at < v_automation.pilot_reset_at then
    update public.captured_offers
       set status = 'ignored', error_code = 'PILOT_DISABLED',
           error_message = 'Oferta anterior à ativação atual do Piloto.',
           processed_at = coalesce(processed_at, now()), scheduled_at = null,
           processing_worker_id = null, processing_deadline_at = null, updated_at = now()
     where id = v_offer.id;
    return jsonb_build_object('status', 'ignored', 'reason', 'PILOT_DISABLED');
  end if;
  if v_offer.queue_quarantined_at is not null
     or v_offer.error_code = 'PILOT_QUEUE_QUARANTINED' then
    raise exception 'Oferta em quarentena não pode ser agendada.' using errcode = 'P0001';
  end if;

  select * into v_sender
    from public.whatsapp_senders
   where id = v_automation.whatsapp_sender_id and account_id = v_automation.account_id;
  if not found then raise exception 'Número responsável não encontrado.' using errcode = 'P0002'; end if;

  -- Destinos = rotas do Piloto que aceitam a fonte e o nicho da oferta
  -- (sem rotas cadastradas: todos os destinos ativos, como antes).
  select count(*)::integer into v_destination_count
    from public.pilot_offer_destinations(v_offer.id);
  if v_destination_count = 0 and exists (
       select 1 from public.pilot_routes route
        where route.account_id = v_automation.account_id and route.automation_id = v_automation.id)
     and exists (
       select 1 from public.automation_destinations destination
        where destination.account_id = v_automation.account_id
          and destination.automation_id = v_automation.id and destination.enabled = true) then
    update public.captured_offers
       set status = 'ignored', error_code = 'NO_MATCHING_ROUTE',
           error_message = 'Nenhuma rota ativa do Piloto aceita esta oferta (grupo fonte ou nicho).',
           processed_at = coalesce(processed_at, now()), scheduled_at = null,
           processing_worker_id = null, processing_deadline_at = null, updated_at = now()
     where id = v_offer.id;
    return jsonb_build_object('status', 'ignored', 'reason', 'NO_MATCHING_ROUTE');
  end if;
  if v_destination_count = 0 then
    update public.captured_offers
       set status = 'ready', processed_at = coalesce(processed_at, now()), scheduled_at = null,
           processing_worker_id = null, processing_deadline_at = null, updated_at = now()
     where id = v_offer.id;
    return jsonb_build_object('status', 'ready', 'destinations', 0);
  end if;
  if v_automation.operating_start >= v_automation.operating_end then
    raise exception 'A janela de funcionamento da automação é inválida.' using errcode = '22023';
  end if;

  v_effective_now := coalesce(p_now, now());
  v_base_at := greatest(v_effective_now, coalesce(v_automation.pilot_next_slot_at, v_effective_now));
  v_local_base := v_base_at at time zone v_automation.timezone;
  if v_local_base::time < v_automation.operating_start then
    v_scheduled_local := v_local_base::date + v_automation.operating_start;
  elsif v_local_base::time > v_automation.operating_end then
    v_scheduled_local := (v_local_base::date + 1) + v_automation.operating_start;
  else
    v_scheduled_local := v_local_base;
  end if;
  v_scheduled_at := v_scheduled_local at time zone v_automation.timezone;

  update public.offer_automations
     set pilot_next_slot_at = v_scheduled_at + public.pilot_send_interval(v_automation),
         updated_at = now()
   where id = v_automation.id;

  v_message_type := case
    when v_automation.keep_original_media and v_offer.media_bucket is not null and v_offer.media_path is not null
      then 'imagem' else 'texto' end;
  v_message_text := case when v_automation.keep_original_text
    then coalesce(v_offer.processed_text, v_offer.original_text, '') else '' end;

  insert into public.envios_grupo_lotes (
    account_id, titulo, whatsapp_sender_id, whatsapp_session_name, tipo,
    texto, legenda, media_bucket, media_path, mime_type, file_name,
    status, total, pendentes, scheduled_at
  ) values (
    v_automation.account_id,
    'Piloto Automático · ' || left(replace(coalesce(v_offer.original_text, 'Oferta'), E'\n', ' '), 70),
    v_automation.whatsapp_sender_id, v_sender.session_name, v_message_type,
    case when v_message_type = 'texto' then v_message_text else null end,
    case when v_message_type = 'imagem' then v_message_text else null end,
    case when v_message_type = 'imagem' then v_offer.media_bucket else null end,
    case when v_message_type = 'imagem' then v_offer.media_path else null end,
    case when v_message_type = 'imagem' then v_offer.media_mime_type else null end,
    case when v_message_type = 'imagem' then 'oferta-' || v_offer.id::text || '.jpg' else null end,
    'pendente', v_destination_count, v_destination_count, v_scheduled_at
  ) returning id into v_lote_id;

  with destinations as (
    select routed.whatsapp_group_id, routed.nome
      from public.pilot_offer_destinations(v_offer.id) routed
  ), dispatches as (
    insert into public.envios_grupo (
      account_id, lote_id, whatsapp_sender_id, whatsapp_session_name,
      group_jid, nome_grupo, tipo, texto, legenda, media_bucket, media_path,
      mime_type, file_name, status, scheduled_at, idempotency_key
    )
    select v_automation.account_id, v_lote_id, v_automation.whatsapp_sender_id, v_sender.session_name,
           destination.whatsapp_group_id, destination.nome, v_message_type,
           case when v_message_type = 'texto' then v_message_text else null end,
           case when v_message_type = 'imagem' then v_message_text else null end,
           case when v_message_type = 'imagem' then v_offer.media_bucket else null end,
           case when v_message_type = 'imagem' then v_offer.media_path else null end,
           case when v_message_type = 'imagem' then v_offer.media_mime_type else null end,
           case when v_message_type = 'imagem' then 'oferta-' || v_offer.id::text || '.jpg' else null end,
           'pendente', v_scheduled_at,
           'pilot:' || v_offer.id::text || ':' || destination.whatsapp_group_id
      from destinations destination
    returning id, group_jid
  )
  insert into public.offer_deliveries (
    account_id, offer_id, destination_group_id, group_dispatch_id,
    link_used, status, scheduled_at
  )
  select v_automation.account_id, v_offer.id, dispatch.group_jid, dispatch.id,
         coalesce(v_offer.affiliate_link, v_offer.original_link), 'scheduled', v_scheduled_at
    from dispatches dispatch;

  update public.captured_offers
     set status = 'scheduled', error_code = null, error_message = null,
         processed_at = coalesce(processed_at, now()), scheduled_at = v_scheduled_at,
         processing_worker_id = null, processing_deadline_at = null, updated_at = now()
   where id = v_offer.id;

  return jsonb_build_object('status', 'scheduled', 'scheduled_at', v_scheduled_at,
    'destinations', v_destination_count, 'already_scheduled', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_offer_schedule_slot(p_automation_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  automation offer_automations;
  base_at timestamptz;
  local_base timestamp;
  scheduled_local timestamp;
  scheduled_at timestamptz;
begin
  select * into automation
    from offer_automations
   where id = p_automation_id
   for update;

  if not found then
    raise exception 'Automação não encontrada.';
  end if;

  base_at := greatest(p_now, coalesce(automation.pilot_next_slot_at, p_now));
  local_base := base_at at time zone automation.timezone;

  if local_base::time < automation.operating_start then
    scheduled_local := local_base::date + automation.operating_start;
  elsif local_base::time > automation.operating_end then
    scheduled_local := (local_base::date + 1) + automation.operating_start;
  else
    scheduled_local := local_base;
  end if;

  scheduled_at := scheduled_local at time zone automation.timezone;

  update offer_automations
     set pilot_next_slot_at = scheduled_at + public.pilot_send_interval(automation),
         updated_at = now()
   where id = automation.id;

  return scheduled_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.compact_pilot_schedule_locked(p_automation_id uuid, p_floor_at timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    coalesce(v_last_sent_at + public.pilot_send_interval(v_automation), now())
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
    v_candidate := v_slot + public.pilot_send_interval(v_automation);
  end loop;

  update public.offer_automations automation
     set pilot_next_slot_at = v_candidate,
         updated_at = now()
   where automation.id = v_automation.id;
end;
$function$;

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
    account_id, created_by, whatsapp_sender_id, enabled, interval_minutes, send_immediately,
    operating_start, operating_end, timezone, keep_original_text,
    keep_original_media, avoid_duplicates, ai_rewrite_enabled,
    shopee_conversion_enabled, mercado_livre_conversion_enabled,
    conversion_failure_policy, updated_at
  ) values (
    p_account_id, auth.uid(), sender_id, (p_input->>'enabled')::boolean,
    (p_input->>'interval_minutes')::integer, coalesce((p_input->>'send_immediately')::boolean, false), (p_input->>'operating_start')::time,
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
    send_immediately = coalesce((p_input->>'send_immediately')::boolean, public.offer_automations.send_immediately),
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
$function$;
