-- Confirmação de envio sem a manutenção do Piloto dentro da mesma chamada (09/10/2026).
--
-- Defeito: complete_whatsapp_job_sent grava o sucesso de uma mensagem que o WhatsApp já aceitou.
-- Quando é o último grupo de uma oferta, a mesma transação também promove ofertas em espera e
-- reorganiza toda a agenda do Piloto (gatilhos promote_waiting_after_pilot_terminal e
-- compact_pilot_schedule_after_terminal_statement), travando a linha do Piloto (offer_automations)
-- que a captura (schedule_pilot_offer) também disputa. Em 09/10, 9 confirmações passaram do limite
-- de 8 s do PostgREST ("canceling statement due to statement timeout"); a confirmação inteira foi
-- desfeita e a mensagem entregue ficou "incerto". As 9 eram o último grupo da oferta.
--
-- Correção: complete_whatsapp_job_sent_deferred grava só a confirmação e registra a manutenção
-- pendente numa fila própria (sem tocar na linha do Piloto). A manutenção roda em chamada separada
-- (run_pilot_maintenance / run_due_pilot_maintenance), chamada pelo serviço logo depois da
-- confirmação e por uma varredura periódica. Se a manutenção falhar ou estiver ocupada, fica
-- pendente e é refeita; a confirmação já está salva.
--
-- Aditiva: as funções antigas continuam iguais. Sem a flag de transação, os gatilhos fazem
-- exatamente o que faziam antes; o serviço atual não muda de comportamento.

create table if not exists public.pilot_maintenance_pending (
  automation_id uuid primary key,
  account_id uuid not null,
  requested_at timestamptz not null default now()
);
-- Sem chave estrangeira de propósito: a verificação travaria a linha do Piloto (KEY SHARE) e
-- disputaria com quem a segura em FOR UPDATE, que é justamente o que esta correção evita.
alter table public.pilot_maintenance_pending enable row level security;
revoke all on public.pilot_maintenance_pending from public, anon, authenticated;

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
    if current_setting('disparei.defer_pilot_maintenance', true) = 'on' then
      insert into public.pilot_maintenance_pending (automation_id, account_id)
      values (new.automation_id, new.account_id)
      on conflict (automation_id) do nothing;
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
  v_defer boolean := current_setting('disparei.defer_pilot_maintenance', true) = 'on';
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
      insert into public.pilot_maintenance_pending (automation_id, account_id)
      values (v_automation.automation_id, v_automation.account_id)
      on conflict (automation_id) do nothing;
    else
      perform public.compact_pilot_schedule_locked(v_automation.automation_id, now());
    end if;
  end loop;
  return null;
end;
$function$;

-- Mesma confirmação, com a manutenção do Piloto adiada para fora desta transação.
create or replace function public.complete_whatsapp_job_sent_deferred(
  p_worker_id text, p_queue_table text, p_message_id uuid, p_claim_token uuid, p_lease_version bigint, p_wa_message_id text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  perform set_config('disparei.defer_pilot_maintenance', 'on', true);
  return public.complete_whatsapp_job_sent(p_worker_id, p_queue_table, p_message_id, p_claim_token, p_lease_version, p_wa_message_id);
end;
$function$;

-- Manutenção de UM Piloto: promove ofertas em espera para as vagas livres e reorganiza a agenda,
-- o mesmo que os gatilhos faziam. Se outra transação estiver com o Piloto, não espera: devolve
-- "ocupado" e a pendência continua para a próxima chamada.
create or replace function public.run_pilot_maintenance(p_automation_id uuid)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_found boolean; v_promoted integer;
begin
  perform 1 from public.offer_automations where id = p_automation_id for update skip locked;
  v_found := found;
  if not v_found then
    if not exists (select 1 from public.offer_automations where id = p_automation_id) then
      delete from public.pilot_maintenance_pending where automation_id = p_automation_id;
      return 'piloto inexistente';
    end if;
    return 'ocupado';
  end if;
  delete from public.pilot_maintenance_pending where automation_id = p_automation_id;
  v_promoted := public.promote_waiting_pilot_offers(p_automation_id, now());
  perform public.compact_pilot_schedule_locked(p_automation_id, now());
  return 'feita: promovidas ' || coalesce(v_promoted, 0);
end;
$function$;

-- Varredura: processa as pendências mais antigas, uma por Piloto, parando antes de 3 s para não
-- encostar no limite de 8 s. Cada Piloto é feito num bloco próprio: erro num não desfaz os outros.
create or replace function public.run_due_pilot_maintenance(p_limit integer default 5)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_started timestamptz := clock_timestamp(); v_item record; v_done integer := 0; v_result text;
begin
  for v_item in
    select automation_id from public.pilot_maintenance_pending
     order by requested_at limit greatest(1, least(coalesce(p_limit, 5), 20))
  loop
    exit when clock_timestamp() - v_started > interval '3 seconds';
    begin
      v_result := public.run_pilot_maintenance(v_item.automation_id);
      if v_result like 'feita%' then v_done := v_done + 1; end if;
    exception when others then
      raise warning 'Manutenção do Piloto % falhou: %', v_item.automation_id, sqlerrm;
    end;
  end loop;
  return v_done;
end;
$function$;

revoke all on function public.complete_whatsapp_job_sent_deferred(text, text, uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.run_pilot_maintenance(uuid) from public, anon, authenticated;
revoke all on function public.run_due_pilot_maintenance(integer) from public, anon, authenticated;
grant execute on function public.complete_whatsapp_job_sent_deferred(text, text, uuid, uuid, bigint, text) to service_role;
grant execute on function public.run_pilot_maintenance(uuid) to service_role;
grant execute on function public.run_due_pilot_maintenance(integer) to service_role;
