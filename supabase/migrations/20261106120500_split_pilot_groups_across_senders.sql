-- Capacidade do número e divisão dos grupos entre números (06/11/2026).
--
-- Caso real (05/11): Piloto com 1 oferta a cada 5 min para 42 grupos, tudo num número só.
-- Cada oferta leva de 10 a 15 min para chegar nos 42 grupos; a fila acumulou 1.065 envios
-- e o mais antigo ficou 6 h atrasado. A conta tinha 3 números conectados.
--
-- Esta migration:
-- 1. offer_automations.split_across_senders (padrão false): opção "Dividir os grupos entre
--    meus números". Desligada = nada muda.
-- 2. create_pilot_offer_schedule_locked: SUBSTITUI a versão de produção. Cópia exata da
--    última versão (20261005200000_pilot_send_immediately.sql) com um único bloco novo,
--    executado só quando split_across_senders = true e a divisão usa mais de 1 número:
--    cria 1 lote por número com a parte dele dos grupos (envios_grupo e offer_deliveries
--    iguais aos de antes, só com o número de cada parte). Se todos os grupos ficarem com
--    o número principal, segue o caminho antigo, sem nenhuma diferença.
--    ANTES DE APLICAR: conferir no banco real que a definição atual é igual à do arquivo
--    20261005200000 (pg_get_functiondef). Se divergir, refazer este arquivo a partir da
--    definição de produção, mantendo só o bloco marcado "Divisão entre números".
--
-- Objetos de produção assumidos: offer_automations (whatsapp_sender_id, pilot_next_slot_at,
-- operating_*, timezone, keep_original_*), captured_offers, offer_deliveries, envios_grupo,
-- envios_grupo_lotes, whatsapp_senders (session_name, connection_status,
-- connection_heartbeat_at, circuit_state, circuit_open_until, created_at),
-- whatsapp_sender_grupos (account_id, whatsapp_sender_id, group_jid), whatsapp_sender_pauses,
-- pilot_routes, automation_destinations, pilot_offer_destinations(uuid),
-- pilot_send_interval(offer_automations), gatilho sync_whatsapp_session_id em envios_grupo.
--
-- Custo: 1 consulta por grupo de destino pela chave (whatsapp_sender_id, group_jid) e pelo
-- índice whatsapp_sender_grupos_group_idx; centenas de grupos ficam bem abaixo de 8 s.
-- Reversão: update offer_automations set split_across_senders = false (efeito imediato).

alter table public.offer_automations
  add column if not exists split_across_senders boolean not null default false;

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
  v_split_dest record;
  v_split_candidate uuid;
  v_split_chosen uuid;
  v_split_sender uuid;
  v_split_member public.whatsapp_senders;
  v_split_share integer;
  v_split_loads jsonb := '{}'::jsonb;
  v_split_groups text[] := '{}'::text[];
  v_split_names text[] := '{}'::text[];
  v_split_senders uuid[] := '{}'::uuid[];
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

  -- Divisão entre números (opt-in, split_across_senders). Cada grupo vai para um
  -- número que está nele: o principal sempre pode; os outros só conectados, sem
  -- pausa e sem disjuntor aberto. Grupos com menos opções primeiro; cada um vai
  -- para o número com menos grupos até ali (empate: principal, depois o mais
  -- antigo). Grupo sem número disponível fica com o principal. Um lote por número,
  -- todos no mesmo horário: a fila envia os lotes de números diferentes em paralelo.
  -- Mesmas regras de web/modules/dispatch-capacity/split.ts.
  if coalesce(v_automation.split_across_senders, false) then
    for v_split_dest in
      select routed.whatsapp_group_id, routed.nome, candidates.ids
        from public.pilot_offer_destinations(v_offer.id) routed
        cross join lateral (
          select coalesce(array_agg(member.id order by (member.id = v_automation.whatsapp_sender_id) desc, member.created_at, member.id), '{}'::uuid[]) as ids
            from public.whatsapp_sender_grupos sender_group
            join public.whatsapp_senders member
              on member.id = sender_group.whatsapp_sender_id and member.account_id = v_automation.account_id
           where sender_group.account_id = v_automation.account_id
             and sender_group.group_jid = routed.whatsapp_group_id
             and (member.id = v_automation.whatsapp_sender_id or (
                  member.connection_status = 'connected'
                  and (member.connection_heartbeat_at is null or member.connection_heartbeat_at > now() - interval '2 minutes')
                  and (member.circuit_state <> 'open' or member.circuit_open_until is null or member.circuit_open_until <= now())
                  and not exists (select 1 from public.whatsapp_sender_pauses pause where pause.whatsapp_sender_id = member.id)))
        ) candidates
       order by case when cardinality(candidates.ids) = 0 then 2147483647 else cardinality(candidates.ids) end,
                routed.whatsapp_group_id collate "C"
    loop
      v_split_chosen := v_automation.whatsapp_sender_id;
      if cardinality(v_split_dest.ids) > 0 then
        v_split_chosen := v_split_dest.ids[1];
        foreach v_split_candidate in array v_split_dest.ids loop
          if coalesce((v_split_loads->>v_split_candidate::text)::integer, 0)
             < coalesce((v_split_loads->>v_split_chosen::text)::integer, 0) then
            v_split_chosen := v_split_candidate;
          end if;
        end loop;
      end if;
      v_split_loads := jsonb_set(v_split_loads, array[v_split_chosen::text],
        to_jsonb(coalesce((v_split_loads->>v_split_chosen::text)::integer, 0) + 1));
      v_split_groups := array_append(v_split_groups, v_split_dest.whatsapp_group_id::text);
      v_split_names := array_append(v_split_names, v_split_dest.nome::text);
      v_split_senders := array_append(v_split_senders, v_split_chosen);
    end loop;

    if (select count(distinct assigned) from unnest(v_split_senders) assigned) > 1 then
      for v_split_sender in
        select assigned.sender_id
          from unnest(v_split_senders) with ordinality assigned(sender_id, position)
         group by assigned.sender_id
         order by (assigned.sender_id = v_automation.whatsapp_sender_id) desc, min(assigned.position)
      loop
        select * into v_split_member from public.whatsapp_senders
         where id = v_split_sender and account_id = v_automation.account_id;
        select count(*)::integer into v_split_share from unnest(v_split_senders) assigned where assigned = v_split_sender;

        insert into public.envios_grupo_lotes (
          account_id, titulo, whatsapp_sender_id, whatsapp_session_name, tipo,
          texto, legenda, media_bucket, media_path, mime_type, file_name,
          status, total, pendentes, scheduled_at
        ) values (
          v_automation.account_id,
          'Piloto Automático · ' || left(replace(coalesce(v_offer.original_text, 'Oferta'), E'\n', ' '), 70),
          v_split_sender, v_split_member.session_name, v_message_type,
          case when v_message_type = 'texto' then v_message_text else null end,
          case when v_message_type = 'imagem' then v_message_text else null end,
          case when v_message_type = 'imagem' then v_offer.media_bucket else null end,
          case when v_message_type = 'imagem' then v_offer.media_path else null end,
          case when v_message_type = 'imagem' then v_offer.media_mime_type else null end,
          case when v_message_type = 'imagem' then 'oferta-' || v_offer.id::text || '.jpg' else null end,
          'pendente', v_split_share, v_split_share, v_scheduled_at
        ) returning id into v_lote_id;

        with dispatches as (
          insert into public.envios_grupo (
            account_id, lote_id, whatsapp_sender_id, whatsapp_session_name,
            group_jid, nome_grupo, tipo, texto, legenda, media_bucket, media_path,
            mime_type, file_name, status, scheduled_at, idempotency_key
          )
          select v_automation.account_id, v_lote_id, v_split_sender, v_split_member.session_name,
                 assigned.group_jid, assigned.nome, v_message_type,
                 case when v_message_type = 'texto' then v_message_text else null end,
                 case when v_message_type = 'imagem' then v_message_text else null end,
                 case when v_message_type = 'imagem' then v_offer.media_bucket else null end,
                 case when v_message_type = 'imagem' then v_offer.media_path else null end,
                 case when v_message_type = 'imagem' then v_offer.media_mime_type else null end,
                 case when v_message_type = 'imagem' then 'oferta-' || v_offer.id::text || '.jpg' else null end,
                 'pendente', v_scheduled_at,
                 'pilot:' || v_offer.id::text || ':' || assigned.group_jid
            from unnest(v_split_groups, v_split_names, v_split_senders) assigned(group_jid, nome, sender_id)
           where assigned.sender_id = v_split_sender
          returning id, group_jid
        )
        insert into public.offer_deliveries (
          account_id, offer_id, destination_group_id, group_dispatch_id,
          link_used, status, scheduled_at
        )
        select v_automation.account_id, v_offer.id, dispatch.group_jid, dispatch.id,
               coalesce(v_offer.affiliate_link, v_offer.original_link), 'scheduled', v_scheduled_at
          from dispatches dispatch;
      end loop;

      update public.captured_offers
         set status = 'scheduled', error_code = null, error_message = null,
             processed_at = coalesce(processed_at, now()), scheduled_at = v_scheduled_at,
             processing_worker_id = null, processing_deadline_at = null, updated_at = now()
       where id = v_offer.id;

      return jsonb_build_object('status', 'scheduled', 'scheduled_at', v_scheduled_at,
        'destinations', v_destination_count, 'already_scheduled', false,
        'split_senders', (select count(distinct assigned) from unnest(v_split_senders) assigned));
    end if;
    -- Todos os grupos ficaram com o principal: segue o caminho de sempre abaixo.
  end if;

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

-- Permissões: create or replace mantém as de produção (EXECUTE revogado de todos os papéis da API
-- em 20260908165112; só as funções do Piloto chamam esta).
