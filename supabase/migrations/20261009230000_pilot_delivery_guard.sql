-- Consistência oferta x envio do Piloto (09/10/2026).
--
-- Defeito: o status da entrega (offer_deliveries) é derivado do envio (envios_grupo) pelo gatilho
-- sync_pilot_delivery_from_group_dispatch, mas o serviço também grava a entrega por conta própria
-- (queue.ts syncOfferDelivery) sem conferir o estado atual. Uma gravação atrasada de "scheduled"
-- (falha temporária de envio) chegando depois de o envio ter virado "incerto" (reinício durante o
-- envio) deixa a entrega em "scheduled" para sempre. A oferta fica "scheduled", ocupa uma das 5
-- vagas do Piloto e a compactação só remarca o horário: nunca sai e nunca libera a vaga.
-- Visto em produção: 18 ofertas em 14 pilotos (08/10 14:45 a 09/10 09:55, período de quedas).

-- 1) Trava: entrega ligada a um envio já terminado não volta para scheduled/sending.
create or replace function public.guard_offer_delivery_against_terminal_dispatch()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_status text;
  v_erro text;
  v_sent_at timestamptz;
begin
  if new.group_dispatch_id is null or new.status not in ('scheduled', 'sending') then
    return new;
  end if;
  select dispatch.status, dispatch.erro, dispatch.sent_at
    into v_status, v_erro, v_sent_at
    from public.envios_grupo dispatch
   where dispatch.id = new.group_dispatch_id
     and dispatch.account_id = new.account_id;
  if v_status in ('sucesso', 'erro', 'incerto', 'cancelado') then
    new.status := case v_status when 'sucesso' then 'sent' when 'erro' then 'failed'
                                when 'incerto' then 'uncertain' else 'cancelled' end;
    new.error_message := case when new.status = 'sent' then null else coalesce(v_erro, new.error_message) end;
    new.sent_at := case when new.status = 'sent' then coalesce(v_sent_at, new.sent_at) else null end;
  end if;
  return new;
end;
$function$;

create trigger guard_offer_delivery_against_terminal_dispatch
  before update of status on public.offer_deliveries
  for each row execute function public.guard_offer_delivery_against_terminal_dispatch();

-- 2) Reconciliação de UMA entrega por chamada (limite de 8 s do PostgREST). Revalida no momento:
-- só corrige se a entrega ainda estiver scheduled/sending e o envio já terminado; trava as duas
-- linhas e pula se o serviço estiver mexendo nelas. Recalcula a oferta com a mesma regra do gatilho
-- de sincronização, considerando todas as entregas (grupos com resultados diferentes). Não cria,
-- não reenvia e não apaga mensagens; "incerto" continua exigindo confirmação manual.
create or replace function public.reconcile_pilot_delivery(p_delivery_id uuid)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_delivery record;
  v_offer record;
  v_offer_status text;
  v_new_delivery_status text;
begin
  select delivery.id, delivery.offer_id, delivery.account_id, delivery.status, dispatch.status envio_status
    into v_delivery
    from public.offer_deliveries delivery
    join public.envios_grupo dispatch
      on dispatch.id = delivery.group_dispatch_id and dispatch.account_id = delivery.account_id
   where delivery.id = p_delivery_id
     for update of delivery, dispatch skip locked;
  if not found then return 'ocupada ou inexistente'; end if;
  if v_delivery.status not in ('scheduled', 'sending') then return 'ja coerente: entrega ' || v_delivery.status; end if;
  if v_delivery.envio_status not in ('sucesso', 'erro', 'incerto', 'cancelado') then
    return 'ja coerente: envio ' || v_delivery.envio_status;
  end if;

  -- a trava (BEFORE UPDATE) troca o status pelo derivado do envio
  update public.offer_deliveries set status = 'scheduled', updated_at = now()
   where id = v_delivery.id returning status into v_new_delivery_status;

  select count(*)::integer total,
         count(*) filter (where status = 'sent')::integer enviados,
         count(*) filter (where status = 'cancelled')::integer cancelados,
         count(*) filter (where status in ('sent', 'failed', 'uncertain', 'cancelled'))::integer terminais,
         count(*) filter (where status = 'sending')::integer enviando,
         max(sent_at) filter (where status = 'sent') ultimo
    into v_offer
    from public.offer_deliveries
   where offer_id = v_delivery.offer_id and account_id = v_delivery.account_id;
  v_offer_status := case
    when v_offer.total > 0 and v_offer.cancelados = v_offer.total then 'ignored'
    when v_offer.total > 0 and v_offer.terminais = v_offer.total and v_offer.enviados > 0 then 'sent'
    when v_offer.total > 0 and v_offer.terminais = v_offer.total then 'send_failed'
    when v_offer.enviando > 0 then 'sending'
    else 'scheduled'
  end;
  update public.captured_offers offer
     set status = v_offer_status,
         sent_at = case when v_offer_status = 'sent' then coalesce(offer.sent_at, v_offer.ultimo, now()) else offer.sent_at end,
         updated_at = now()
   where offer.id = v_delivery.offer_id and offer.account_id = v_delivery.account_id
     and offer.status in ('scheduled', 'sending')
     and offer.status is distinct from v_offer_status;
  return 'corrigida: entrega ' || v_delivery.status || '->' || v_new_delivery_status || ', oferta ' || v_offer_status;
end;
$function$;

revoke all on function public.reconcile_pilot_delivery(uuid) from public, anon, authenticated;
