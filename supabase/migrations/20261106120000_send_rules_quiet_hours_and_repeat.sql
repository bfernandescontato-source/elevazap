-- Regras de envio por conta (06/11/2026):
--   1) Pausa noturna geral: nada sai entre quiet_start e quiet_end (fuso de Brasília).
--      Envio marcado dentro da pausa é empurrado para o fim dela, nunca descartado.
--   2) Produto repetido: o mesmo produto (marketplace + código do anúncio) não volta
--      ao mesmo grupo antes de product_repeat_days dias. O envio repetido nasce
--      "cancelado" com motivo visível (erro + last_error_code = PRODUCT_REPEATED).
--
-- Nasce DESLIGADO para todas as contas (sem linha = sem regra): nada muda até o
-- aluno ligar em Configurações > Envios.
--
-- Onde a regra é aplicada: gatilhos BEFORE em envios_grupo (toda fila de grupo passa
-- por ali: Piloto, Catálogo, Agenda, lotes e agendamento em massa) e nas tabelas que
-- só exibem o horário (envios_grupo_lotes, offer_deliveries, captured_offers). Nenhuma
-- função existente do Piloto é substituída. Envios individuais (tabela envios, ex.:
-- confirmação de compra) ficam de fora de propósito.
--
-- Cada gatilho faz no máximo uma leitura por chave primária (configuração da conta)
-- e, só com a regra de repetição ligada, uma consulta pelo índice de product_key.
-- Não reescreve histórico: product_key só é preenchido em envios novos.

begin;

create table if not exists public.account_send_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  quiet_hours_enabled boolean not null default false,
  quiet_start time not null default '22:00',
  quiet_end time not null default '06:00',
  product_repeat_days smallint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint account_send_settings_quiet_window check (quiet_start <> quiet_end),
  constraint account_send_settings_repeat_days check (product_repeat_days between 0 and 30)
);

alter table public.account_send_settings enable row level security;
drop policy if exists tenant_isolation on public.account_send_settings;
create policy tenant_isolation on public.account_send_settings for all to authenticated
  using (account_id = public.current_account_id() and public.current_account_is_active())
  with check (account_id = public.current_account_id() and public.current_account_is_active());
grant select, insert, update on public.account_send_settings to authenticated;

-- Identidade do produto em cada envio de grupo (nulo = texto livre, sem regra).
alter table public.envios_grupo add column if not exists product_key text;

-- "SHOPEE:123", "MERCADO_LIVRE:MLB123". O Piloto grava o marketplace em minúsculas
-- (shopee, mercado_livre, amazon); "multiple" não identifica um produto só.
create or replace function public.send_product_key(p_provider text, p_item_id text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select case
    when nullif(btrim(coalesce(p_provider, '')), '') is null
      or nullif(btrim(coalesce(p_item_id, '')), '') is null
      or lower(btrim(p_provider)) = 'multiple' then null
    else upper(btrim(p_provider)) || ':' || upper(btrim(p_item_id))
  end
$$;

-- Empurra p_at para o fim da pausa quando cai dentro dela. Janela pode cruzar a
-- meia-noite (22:00 às 06:00). Início incluído, fim excluído.
create or replace function public.send_quiet_shift(p_at timestamptz, p_start time, p_end time)
returns timestamptz
language plpgsql
stable
set search_path to 'pg_catalog'
as $$
declare
  v_local timestamp;
  v_time time;
  v_day date;
begin
  if p_at is null or p_start is null or p_end is null or p_start = p_end then
    return p_at;
  end if;
  v_local := p_at at time zone 'America/Sao_Paulo';
  v_time := v_local::time;
  v_day := v_local::date;
  if p_start < p_end then
    if v_time >= p_start and v_time < p_end then
      return (v_day + p_end) at time zone 'America/Sao_Paulo';
    end if;
  else
    if v_time >= p_start then
      return ((v_day + 1) + p_end) at time zone 'America/Sao_Paulo';
    elsif v_time < p_end then
      return (v_day + p_end) at time zone 'America/Sao_Paulo';
    end if;
  end if;
  return p_at;
end;
$$;

create or replace function public.send_quiet_shift_for_account(p_account_id uuid, p_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce((
    select public.send_quiet_shift(p_at, settings.quiet_start, settings.quiet_end)
      from public.account_send_settings settings
     where settings.account_id = p_account_id and settings.quiet_hours_enabled
  ), p_at)
$$;

create or replace function public.send_quiet_hours_active(p_account_id uuid, p_now timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.send_quiet_shift_for_account(p_account_id, p_now) is distinct from p_now
$$;

create or replace function public.send_guard_try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path to 'pg_catalog'
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

-- Fila de grupo: horário fora da pausa e bloqueio de produto repetido.
create or replace function public.send_guard_group_dispatch()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_settings public.account_send_settings;
  v_offer record;
  v_at timestamptz;
  v_days integer;
begin
  -- Piloto: idempotency_key = 'pilot:<oferta>:<grupo>'. O produto vem da oferta.
  if tg_op = 'INSERT' and new.product_key is null and new.idempotency_key like 'pilot:%' then
    select offer.affiliate_provider, offer.item_id into v_offer
      from public.captured_offers offer
     where offer.id = public.send_guard_try_uuid(split_part(new.idempotency_key, ':', 2))
       and offer.account_id = new.account_id;
    if found then
      new.product_key := public.send_product_key(v_offer.affiliate_provider, v_offer.item_id);
    end if;
  end if;

  if coalesce(new.status, 'pendente') <> 'pendente' then
    return new;
  end if;

  select * into v_settings from public.account_send_settings where account_id = new.account_id;
  if not found then
    return new;
  end if;

  if v_settings.quiet_hours_enabled then
    new.scheduled_at := public.send_quiet_shift(coalesce(new.scheduled_at, now()), v_settings.quiet_start, v_settings.quiet_end);
    if new.next_attempt_at is not null then
      new.next_attempt_at := public.send_quiet_shift(new.next_attempt_at, v_settings.quiet_start, v_settings.quiet_end);
    end if;
  end if;

  v_days := v_settings.product_repeat_days;
  if tg_op = 'INSERT' and v_days > 0 and new.product_key is not null then
    v_at := coalesce(new.scheduled_at, now());
    if exists (
      select 1
        from public.envios_grupo previous
       where previous.account_id = new.account_id
         and previous.group_jid = new.group_jid
         and previous.product_key = new.product_key
         and previous.status in ('pendente', 'enfileirado', 'processando', 'sucesso', 'incerto', 'pausado')
         and previous.scheduled_at > v_at - make_interval(days => v_days)
         and previous.scheduled_at < v_at + make_interval(days => v_days)
    ) then
      new.status := 'cancelado';
      new.last_error_code := 'PRODUCT_REPEATED';
      new.erro := 'Produto repetido. Este grupo já recebeu ou vai receber este produto em menos de '
        || v_days || case when v_days = 1 then ' dia.' else ' dias.' end;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists send_guard_group_dispatch on public.envios_grupo;
create trigger send_guard_group_dispatch
  before insert or update of scheduled_at, next_attempt_at on public.envios_grupo
  for each row execute function public.send_guard_group_dispatch();

-- Lote com envio bloqueado na criação: recalcula contadores e status (um lote só
-- com repetidos vira "cancelado" em vez de ficar "pendente" para sempre).
create or replace function public.send_guard_recalc_repeated_lotes()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_lote uuid;
begin
  for v_lote in
    select distinct inserted.lote_id
      from send_guard_inserted inserted
     where inserted.lote_id is not null
       and inserted.last_error_code = 'PRODUCT_REPEATED'
       and inserted.status = 'cancelado'
  loop
    perform public.recalc_lote_counts(v_lote);
  end loop;
  return null;
end;
$function$;

drop trigger if exists send_guard_recalc_repeated_lotes on public.envios_grupo;
create trigger send_guard_recalc_repeated_lotes
  after insert on public.envios_grupo
  referencing new table as send_guard_inserted
  for each statement execute function public.send_guard_recalc_repeated_lotes();

-- Lote: só o horário exibido (os envios já são ajustados acima).
create or replace function public.send_guard_lote_schedule()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if coalesce(new.status, 'pendente') = 'pendente' and new.scheduled_at is not null then
    new.scheduled_at := public.send_quiet_shift_for_account(new.account_id, new.scheduled_at);
  end if;
  return new;
end;
$function$;

drop trigger if exists send_guard_lote_schedule on public.envios_grupo_lotes;
create trigger send_guard_lote_schedule
  before insert or update of scheduled_at on public.envios_grupo_lotes
  for each row execute function public.send_guard_lote_schedule();

-- Entrega do Piloto: nasce com o estado e o horário do envio de grupo (que pode ter
-- sido bloqueado ou empurrado acima). Sem isto a entrega ficaria "scheduled" com o
-- envio já cancelado e a oferta ocuparia uma vaga do Piloto para sempre.
create or replace function public.send_guard_offer_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_dispatch record;
begin
  if tg_op = 'INSERT' then
    if new.group_dispatch_id is null then return new; end if;
    select dispatch.status, dispatch.erro, dispatch.scheduled_at into v_dispatch
      from public.envios_grupo dispatch
     where dispatch.id = new.group_dispatch_id and dispatch.account_id = new.account_id;
    if not found then return new; end if;
    if v_dispatch.status = 'cancelado' and new.status in ('pending', 'scheduled') then
      new.status := 'cancelled';
      new.error_message := v_dispatch.erro;
    elsif v_dispatch.status = 'pendente' and new.scheduled_at is not null then
      new.scheduled_at := v_dispatch.scheduled_at;
    end if;
  elsif new.status = 'scheduled' and new.scheduled_at is not null then
    new.scheduled_at := public.send_quiet_shift_for_account(new.account_id, new.scheduled_at);
  end if;
  return new;
end;
$function$;

drop trigger if exists send_guard_offer_delivery on public.offer_deliveries;
create trigger send_guard_offer_delivery
  before insert or update of scheduled_at on public.offer_deliveries
  for each row execute function public.send_guard_offer_delivery();

-- Oferta do Piloto: horário exibido fora da pausa e, se TODOS os grupos foram
-- bloqueados por produto repetido, a oferta vira "ignored" com o motivo (não ocupa
-- vaga da fila). A troca acontece a partir de processing/ready/waiting, então não
-- dispara promoção nem compactação (só reagem a saídas de scheduled/sending).
create or replace function public.send_guard_captured_offer()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if new.status <> 'scheduled' then return new; end if;
  if new.scheduled_at is not null then
    new.scheduled_at := public.send_quiet_shift_for_account(new.account_id, new.scheduled_at);
  end if;
  if old.status is distinct from 'scheduled'
     and exists (
       select 1 from public.offer_deliveries delivery
         join public.envios_grupo dispatch
           on dispatch.id = delivery.group_dispatch_id and dispatch.account_id = delivery.account_id
        where delivery.offer_id = new.id and delivery.account_id = new.account_id
          and dispatch.last_error_code = 'PRODUCT_REPEATED')
     and not exists (
       select 1 from public.offer_deliveries delivery
        where delivery.offer_id = new.id and delivery.account_id = new.account_id
          and delivery.status <> 'cancelled') then
    new.status := 'ignored';
    new.error_code := 'PRODUCT_REPEATED';
    new.error_message := 'Produto repetido. Todos os grupos já receberam este produto há pouco tempo.';
    new.scheduled_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists send_guard_captured_offer on public.captured_offers;
create trigger send_guard_captured_offer
  before update of status, scheduled_at on public.captured_offers
  for each row execute function public.send_guard_captured_offer();

revoke all on function public.send_guard_group_dispatch() from public, anon, authenticated;
revoke all on function public.send_guard_recalc_repeated_lotes() from public, anon, authenticated;
revoke all on function public.send_guard_lote_schedule() from public, anon, authenticated;
revoke all on function public.send_guard_offer_delivery() from public, anon, authenticated;
revoke all on function public.send_guard_captured_offer() from public, anon, authenticated;
revoke all on function public.send_quiet_shift_for_account(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.send_quiet_hours_active(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.send_quiet_shift_for_account(uuid, timestamptz) to service_role;
grant execute on function public.send_quiet_hours_active(uuid, timestamptz) to service_role;

notify pgrst, 'reload schema';

commit;

-- Teste sugerido antes de aplicar (transação desfeita):
-- do $$ begin raise exception 'RESULTADO: % | % | %',
--   public.send_quiet_shift('2026-11-06 23:30-03', '22:00', '06:00'),
--   public.send_quiet_shift('2026-11-06 05:10-03', '22:00', '06:00'),
--   public.send_quiet_shift('2026-11-06 12:00-03', '22:00', '06:00'); end $$;
