-- Reorganização do Piloto fora das transações de envio e de captura (09-10/10/2026).
--
-- Defeito: quando uma oferta do Piloto termina (último grupo enviado, falha, incerto, cancelamento),
-- a MESMA transação promove ofertas em espera e reorganiza a agenda (gatilhos
-- promote_waiting_after_pilot_terminal e compact_pilot_schedule_after_terminal_statement), segurando
-- a linha do Piloto (offer_automations ... for update). A captura (schedule_pilot_offer) também
-- promove sob a mesma trava. Em 09/10, 9 confirmações de mensagens já enviadas passaram do limite de
-- 8 s do PostgREST e foram desfeitas (todas eram o último grupo da oferta); a captura chegou a 7,8 s.
--
-- Correção: com o modo 'deferred', nenhum desses caminhos reorganiza o Piloto. Eles só registram um
-- pedido (tabela só de inserção: nunca espera trava e é gravado na mesma transação da mudança de
-- status, então nenhum reinício perde o pedido). Um trabalhador pega os pedidos e reorganiza cada
-- Piloto em chamada própria (claim_pilot_maintenance + run_pilot_maintenance), sem esperar trava:
-- Piloto ocupado continua pendente; falha volta com intervalo crescente; depois de 6 falhas a tarefa
-- fica marcada como esgotada (visível em pilot_queue_health) e ainda é tentada a cada 30 min.
--
-- Modo 'inline' (padrão desta migration): comportamento idêntico ao atual. Liga-se 'deferred' só
-- depois que o serviço com o trabalhador estiver publicado. Reversão: modo 'inline' + drenar.

create table if not exists public.pilot_maintenance_settings (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'inline' check (mode in ('inline', 'deferred')),
  updated_at timestamptz not null default now()
);
insert into public.pilot_maintenance_settings (singleton, mode) values (true, 'inline') on conflict do nothing;

-- Pedidos: só inserção. Sem chave estrangeira de propósito (a verificação travaria a linha do Piloto
-- em KEY SHARE, disputando com quem a segura em FOR UPDATE, que é o que esta correção evita).
create table if not exists public.pilot_maintenance_requests (
  id bigserial primary key,
  automation_id uuid not null,
  account_id uuid not null,
  reason text not null,
  requested_at timestamptz not null default now()
);
create index if not exists pilot_maintenance_requests_automation_idx on public.pilot_maintenance_requests (automation_id, id);

-- Estado de cada Piloto com pedido: tentativas, próxima tentativa, erro, esgotada.
create table if not exists public.pilot_maintenance_state (
  automation_id uuid primary key,
  account_id uuid not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  last_error text,
  exhausted_at timestamptz,
  last_done_at timestamptz
);

alter table public.pilot_maintenance_settings enable row level security;
alter table public.pilot_maintenance_requests enable row level security;
alter table public.pilot_maintenance_state enable row level security;
revoke all on public.pilot_maintenance_settings, public.pilot_maintenance_requests, public.pilot_maintenance_state from public, anon, authenticated;

create or replace function public.pilot_maintenance_deferred()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select coalesce((select mode = 'deferred' from public.pilot_maintenance_settings where singleton), false)
$function$;

create or replace function public.request_pilot_maintenance(p_automation_id uuid, p_account_id uuid, p_reason text)
returns void
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  insert into public.pilot_maintenance_requests (automation_id, account_id, reason)
  values (p_automation_id, p_account_id, p_reason)
$function$;

CREATE OR REPLACE FUNCTION public.promote_waiting_after_pilot_terminal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if old.status in ('scheduled','sending')
     and new.status in ('sent','ignored','duplicate','processing_failed','send_failed')
     and not exists (
       select 1 from public.offer_deliveries delivery
        where delivery.offer_id=new.id
          and delivery.status in ('pending','scheduled','sending')
     ) then
    if public.pilot_maintenance_deferred() then
      perform public.request_pilot_maintenance(new.automation_id, new.account_id, 'oferta terminou: ' || new.status);
    else
      perform public.promote_waiting_pilot_offers(new.automation_id, now());
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.compact_pilot_schedule_after_terminal_statement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_automation record;
  v_defer boolean := public.pilot_maintenance_deferred();
begin
  for v_automation in
    select distinct new_offer.automation_id, new_offer.account_id
      from old_pilot_offers old_offer
      join new_pilot_offers new_offer on new_offer.id = old_offer.id
     where old_offer.status in ('scheduled', 'sending')
       and new_offer.status in ('sent', 'ignored', 'duplicate', 'processing_failed', 'send_failed')
       and old_offer.status is distinct from new_offer.status
  loop
    if v_defer then
      perform public.request_pilot_maintenance(v_automation.automation_id, v_automation.account_id, 'reorganizar agenda');
    else
      perform public.compact_pilot_schedule_locked(v_automation.automation_id, now());
    end if;
  end loop;
  return null;
end;
$function$;

-- Captura: igual à de produção; só a promoção final passa a ser pedido quando o modo é 'deferred'.
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
  if public.pilot_maintenance_deferred() then
    perform public.request_pilot_maintenance(v_automation.id, v_automation.account_id, 'oferta capturada');
  else
    perform public.promote_waiting_pilot_offers(v_automation.id, p_now);
  end if;
  select jsonb_build_object('status', status, 'scheduled_at', scheduled_at,
           'destinations', case when status='scheduled' then v_destinations else 0 end,
           'already_scheduled', false)
    into v_result from public.captured_offers where id=v_offer.id;
  return v_result;
end;
$function$;

-- Trabalhador, passo 1: reserva até p_limit Pilotos com pedido e tentativa vencida. Conta a tentativa
-- e já marca a próxima (intervalo crescente) ANTES do trabalho: se o trabalho estourar o tempo ou o
-- trabalhador cair, a tarefa volta sozinha depois, sem travar a fila dos outros Pilotos.
create or replace function public.claim_pilot_maintenance(p_worker_id text, p_limit integer default 5)
returns table(automation_id uuid, attempts integer)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
#variable_conflict use_column
declare v_item record; v_attempts integer;
begin
  for v_item in
    select r.automation_id, min(r.account_id::text)::uuid account_id, min(r.id) first_id
      from public.pilot_maintenance_requests r
      left join public.pilot_maintenance_state s on s.automation_id = r.automation_id
     where s.automation_id is null or s.next_attempt_at <= now()
     group by r.automation_id
     order by min(r.id)
     limit greatest(1, least(coalesce(p_limit, 5), 20))
  loop
    insert into public.pilot_maintenance_state as s (automation_id, account_id, attempts, next_attempt_at, claimed_by, claimed_at)
    values (v_item.automation_id, v_item.account_id, 1, now() + interval '30 seconds', p_worker_id, now())
    on conflict (automation_id) do update set
      attempts = s.attempts + 1,
      next_attempt_at = now() + case
        when s.attempts + 1 >= 6 then interval '30 minutes'
        else make_interval(secs => least(600, 30 * power(2, s.attempts)::integer)) end,
      exhausted_at = case when s.attempts + 1 >= 6 then coalesce(s.exhausted_at, now()) else s.exhausted_at end,
      claimed_by = excluded.claimed_by, claimed_at = now()
    where s.next_attempt_at <= now()
    returning s.attempts into v_attempts;
    if v_attempts is not null then
      automation_id := v_item.automation_id; attempts := v_attempts; return next;
    end if;
    v_attempts := null;
  end loop;
end;
$function$;

-- Trabalhador, passo 2: reorganiza UM Piloto. Não espera trava: ocupado devolve 'ocupado', não conta
-- a tentativa e volta em 2 s. Só apaga os pedidos que existiam quando começou; pedido que chegar
-- durante o trabalho continua na fila. Erro ou tempo esgotado desfaz tudo e o pedido continua.
create or replace function public.run_pilot_maintenance(p_automation_id uuid)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_last_request bigint; v_promoted integer;
begin
  perform 1 from public.offer_automations where id = p_automation_id for update skip locked;
  if not found then
    if not exists (select 1 from public.offer_automations where id = p_automation_id) then
      delete from public.pilot_maintenance_requests where automation_id = p_automation_id;
      delete from public.pilot_maintenance_state where automation_id = p_automation_id;
      return 'piloto inexistente';
    end if;
    update public.pilot_maintenance_state
       set attempts = greatest(attempts - 1, 0), next_attempt_at = now() + interval '2 seconds'
     where automation_id = p_automation_id;
    return 'ocupado';
  end if;
  select max(id) into v_last_request from public.pilot_maintenance_requests where automation_id = p_automation_id;
  v_promoted := public.promote_waiting_pilot_offers(p_automation_id, now());
  perform public.compact_pilot_schedule_locked(p_automation_id, now());
  delete from public.pilot_maintenance_requests where automation_id = p_automation_id and id <= coalesce(v_last_request, 0);
  update public.pilot_maintenance_state
     set attempts = 0, next_attempt_at = now(), last_error = null, exhausted_at = null, last_done_at = now()
   where automation_id = p_automation_id;
  return 'feita: promovidas ' || coalesce(v_promoted, 0);
end;
$function$;

-- Registro de erro do trabalhador (chamado pelo serviço quando run_pilot_maintenance falha).
create or replace function public.fail_pilot_maintenance(p_automation_id uuid, p_error text)
returns void
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  update public.pilot_maintenance_state set last_error = left(p_error, 500) where automation_id = p_automation_id
$function$;

-- Reversão / emergência: faz a manutenção de todos os pendentes no modo antigo, um Piloto por chamada.
create or replace function public.drain_pilot_maintenance_one()
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_automation uuid;
begin
  select automation_id into v_automation from public.pilot_maintenance_requests order by id limit 1;
  if v_automation is null then return 'vazio'; end if;
  return public.run_pilot_maintenance(v_automation);
end;
$function$;

-- Saúde para o alerta: tudo que não pode falhar em silêncio.
create or replace function public.pilot_queue_health()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'mode', (select mode from public.pilot_maintenance_settings where singleton),
    'pending_pilots', (select count(distinct automation_id) from public.pilot_maintenance_requests),
    'oldest_request_seconds', (select coalesce(extract(epoch from now() - min(requested_at))::integer, 0) from public.pilot_maintenance_requests),
    'overdue_pilots', (select count(distinct automation_id) from public.pilot_maintenance_requests where requested_at < now() - interval '2 minutes'),
    'retrying_pilots', (select count(*) from public.pilot_maintenance_state where attempts > 1 and exhausted_at is null),
    'exhausted_pilots', (select count(*) from public.pilot_maintenance_state where exhausted_at is not null),
    'confirmation_not_saved_1h', (select count(*) from public.envios_grupo
       where status = 'incerto' and last_error_code = 'PERSIST_SUCCESS_FAILED' and updated_at > now() - interval '1 hour')
  )
$function$;

revoke all on function public.pilot_maintenance_deferred(), public.request_pilot_maintenance(uuid, uuid, text),
  public.claim_pilot_maintenance(text, integer), public.run_pilot_maintenance(uuid), public.fail_pilot_maintenance(uuid, text),
  public.drain_pilot_maintenance_one(), public.pilot_queue_health() from public, anon, authenticated;
grant execute on function public.claim_pilot_maintenance(text, integer), public.run_pilot_maintenance(uuid),
  public.fail_pilot_maintenance(uuid, text), public.pilot_queue_health() to service_role;
