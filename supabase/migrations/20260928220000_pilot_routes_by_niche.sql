-- Rotas do Piloto por nicho (aplicada em produção em 28/09/2026).
-- Uma rota = grupos fonte + nichos + grupos destino. Cada oferta capturada vai
-- só para os destinos das rotas ativas que aceitam o grupo de origem e o nicho
-- dela. Sem nenhuma rota cadastrada, vale o comportamento antigo (todos os
-- destinos). Toda automação existente ganha a rota "Principal" (todas as
-- fontes, qualquer nicho, todos os destinos) = nada muda até o usuário editar.

-- Subnicho → nicho principal (Maquiagem → Beleza). A oferta guarda o nicho e os
-- "pais", então uma rota "Beleza" também recebe maquiagem.
alter table public.niches add column if not exists parent_id text references public.niches(id);
update public.niches set parent_id = 'beleza' where id in ('maquiagem','skincare','cabelos','perfumes','barba');
update public.niches set parent_id = 'casa' where id in ('cozinha','decoracao','organizacao','utilidades','iluminacao','moveis','ferramentas','jardim');
update public.niches set parent_id = 'eletronicos' where id in ('celulares','audio','informatica','games','cameras');
update public.niches set parent_id = 'bebe' where id = 'brinquedos';
update public.niches set parent_id = 'esportes' where id = 'fitness';
update public.niches set parent_id = 'acessorios' where id = 'joias';

-- Nicho de cada oferta capturada (preenchido pelo whatsapp-service só quando a
-- automação tem rota com nicho). niche_source: shopee_category | ai | none.
alter table public.captured_offers
  add column if not exists niche_ids text[],
  add column if not exists niche_source text,
  add column if not exists niche_resolved_at timestamptz;

-- Cache de categoria por produto (a mesma oferta circula em muitos grupos).
create table if not exists public.product_niches (
  provider text not null,
  product_key text not null,
  category_ids bigint[] not null default '{}',
  niche_ids text[] not null default '{}',
  resolved_at timestamptz not null default now(),
  primary key (provider, product_key)
);
alter table public.product_niches enable row level security;

create table if not exists public.pilot_routes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  automation_id uuid not null references public.offer_automations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  enabled boolean not null default true,
  all_sources boolean not null default false,
  source_group_ids text[] not null default '{}',
  any_niche boolean not null default false,
  niche_ids text[] not null default '{}',
  all_destinations boolean not null default false,
  destination_group_ids text[] not null default '{}',
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pilot_routes_automation_idx on public.pilot_routes (account_id, automation_id);
alter table public.pilot_routes enable row level security;

-- Destinos de uma oferta: destinos ativos do Piloto que alguma rota ativa
-- aceita (fonte + nicho). Sem rotas: todos os destinos ativos.
create or replace function public.pilot_offer_destinations(p_offer_id uuid)
returns table (whatsapp_group_id text, nome text)
language sql stable security definer set search_path = pg_catalog, public as $$
  with offer as (
    select o.account_id, o.automation_id, o.source_group_id, coalesce(o.niche_ids, '{}'::text[]) as niche_ids
      from public.captured_offers o where o.id = p_offer_id
  ), active_destinations as (
    select d.whatsapp_group_id
      from public.automation_destinations d join offer o
        on d.account_id = o.account_id and d.automation_id = o.automation_id
     where d.enabled
  ), has_routes as (
    select exists (
      select 1 from public.pilot_routes r join offer o
        on r.account_id = o.account_id and r.automation_id = o.automation_id) as value
  ), chosen as (
    select ad.whatsapp_group_id from active_destinations ad, has_routes h where not h.value
    union
    select ad.whatsapp_group_id
      from public.pilot_routes r
      join offer o on r.account_id = o.account_id and r.automation_id = o.automation_id
      join active_destinations ad on r.all_destinations or ad.whatsapp_group_id = any(r.destination_group_ids)
     where r.enabled
       and (r.all_sources or o.source_group_id = any(r.source_group_ids))
       and (r.any_niche or r.niche_ids && o.niche_ids)
  )
  select c.whatsapp_group_id, g.nome
    from chosen c cross join offer o
    left join public.grupos g on g.account_id = o.account_id and g.group_jid = c.whatsapp_group_id;
$$;
revoke all on function public.pilot_offer_destinations(uuid) from public, anon, authenticated;
grant execute on function public.pilot_offer_destinations(uuid) to service_role;

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
     set pilot_next_slot_at = v_scheduled_at + make_interval(mins => v_automation.interval_minutes),
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
$function$
;

CREATE OR REPLACE FUNCTION public.schedule_pilot_offer(p_offer_id uuid, p_worker_id text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_offer public.captured_offers;
  v_automation public.offer_automations;
  v_existing_delivery_count integer;
  v_existing_sent_count integer;
  v_existing_cancelled_count integer;
  v_existing_terminal_count integer;
  v_existing_sending_count integer;
  v_existing_status text;
  v_destinations integer;
  v_result jsonb;
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'Identificador do worker inválido.' using errcode = '22023';
  end if;
  select * into v_offer from public.captured_offers where id = p_offer_id for update;
  if not found then raise exception 'Oferta não encontrada.' using errcode = 'P0002'; end if;

  if v_offer.status in ('waiting', 'scheduled', 'sending', 'sent') then
    return jsonb_build_object('status', v_offer.status, 'scheduled_at', v_offer.scheduled_at,
      'already_scheduled', true);
  end if;
  if v_offer.status not in ('processing', 'ready') then
    raise exception 'Oferta não está pronta para agendamento.' using errcode = 'P0001';
  end if;
  if v_offer.status = 'processing' and (
       v_offer.processing_worker_id is distinct from p_worker_id
       or v_offer.processing_deadline_at is null
       or v_offer.processing_deadline_at <= now()
     ) then
    raise exception 'Lease de processamento inválido ou expirado.' using errcode = '40001';
  end if;
  if v_offer.queue_quarantined_at is not null
     or v_offer.error_code = 'PILOT_QUEUE_QUARANTINED' then
    raise exception 'Oferta em quarentena não pode ser agendada.' using errcode = 'P0001';
  end if;

  select count(*)::integer,
         count(*) filter (where status = 'sent')::integer,
         count(*) filter (where status = 'cancelled')::integer,
         count(*) filter (where status in ('sent','failed','uncertain','cancelled'))::integer,
         count(*) filter (where status = 'sending')::integer
    into v_existing_delivery_count, v_existing_sent_count, v_existing_cancelled_count,
         v_existing_terminal_count, v_existing_sending_count
    from public.offer_deliveries where offer_id = v_offer.id and account_id = v_offer.account_id;
  if v_existing_delivery_count > 0 then
    v_existing_status := case
      when v_existing_cancelled_count = v_existing_delivery_count then 'ignored'
      when v_existing_terminal_count = v_existing_delivery_count and v_existing_sent_count > 0 then 'sent'
      when v_existing_terminal_count = v_existing_delivery_count then 'send_failed'
      when v_existing_sending_count > 0 then 'sending' else 'scheduled' end;
    update public.captured_offers set status = v_existing_status,
      processing_worker_id = null, processing_deadline_at = null, updated_at = now()
     where id = v_offer.id;
    return jsonb_build_object('status', v_existing_status, 'scheduled_at', v_offer.scheduled_at,
      'destinations', v_existing_delivery_count, 'already_scheduled', true);
  end if;

  select * into v_automation from public.offer_automations
   where id = v_offer.automation_id and account_id = v_offer.account_id for update;
  if not found then raise exception 'Automação não encontrada.' using errcode = 'P0002'; end if;
  if not v_automation.enabled or v_offer.captured_at < v_automation.pilot_reset_at then
    update public.captured_offers set status='ignored', error_code='PILOT_DISABLED',
      error_message='Oferta anterior à ativação atual do Piloto.', processed_at=coalesce(processed_at,now()),
      scheduled_at=null, processing_worker_id=null, processing_deadline_at=null, updated_at=now()
     where id=v_offer.id;
    return jsonb_build_object('status','ignored','reason','PILOT_DISABLED');
  end if;

  -- Oferta que nenhuma rota aceita não entra na fila: resolve na hora (ignored).
  select count(*)::integer into v_destinations from public.pilot_offer_destinations(v_offer.id);
  if v_destinations = 0 then
    return public.create_pilot_offer_schedule_locked(v_offer.id, p_now);
  end if;

  -- Put every processed offer in the durable FIFO first. The promoter, under
  -- the same automation lock, assigns at most five physical future slots.
  update public.captured_offers
     set status='waiting', scheduled_at=null, error_code=null, error_message=null,
         processed_at=coalesce(processed_at,now()), processing_worker_id=null,
         processing_deadline_at=null, updated_at=now()
   where id=v_offer.id;
  perform public.promote_waiting_pilot_offers(v_automation.id, p_now);
  select jsonb_build_object('status', status, 'scheduled_at', scheduled_at,
           'destinations', case when status='scheduled' then v_destinations else 0 end,
           'already_scheduled', false)
    into v_result from public.captured_offers where id=v_offer.id;
  return v_result;
end;
$function$
;

-- Rota "Principal" para cada automação existente (mesmo comportamento de hoje).
insert into public.pilot_routes (account_id, automation_id, name, all_sources, any_niche, all_destinations, sort)
select a.account_id, a.id, 'Principal', true, true, true, 0
  from public.offer_automations a
 where not exists (select 1 from public.pilot_routes r where r.automation_id = a.id);
