-- Fila do Piloto: a mais nova sai primeiro e oferta parada há mais de 2 h é descartada.
--
-- Antes a fila saía pela mais antiga e nunca descartava nada. Com grupos fonte
-- postando ~40 ofertas/h e o Piloto enviando 12/h (1 a cada 5 min), a fila crescia
-- sem parar: contas com 3.000 ofertas esperando, a mais velha de 16 dias, e uma
-- oferta boa que acabava de chegar só sairia dias depois (preço/cupom vencidos).

create or replace function public.promote_waiting_pilot_offers(p_automation_id uuid, p_now timestamp with time zone default now())
 returns integer
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_automation public.offer_automations;
  v_offer_id uuid;
  v_slots integer;
  v_promoted integer := 0;
  v_result jsonb;
begin
  select * into v_automation
    from public.offer_automations where id = p_automation_id for update;
  if not found or not v_automation.enabled then return 0; end if;

  -- waiting -> ignored não dispara os gatilhos de promoção/compactação (só saem de scheduled/sending).
  update public.captured_offers
     set status = 'ignored', error_code = 'QUEUE_EXPIRED',
         error_message = 'Oferta ficou mais de 2 horas na fila sem vaga para envio.', updated_at = now()
   where automation_id = v_automation.id
     and account_id = v_automation.account_id
     and status = 'waiting'
     and captured_at < p_now - interval '2 hours';

  loop
    select count(*)::integer into v_slots
      from public.captured_offers
     where automation_id = v_automation.id
       and account_id = v_automation.account_id
       and status in ('scheduled', 'sending');
    exit when v_slots >= 5;

    select offer.id into v_offer_id
      from public.captured_offers offer
     where offer.automation_id = v_automation.id
       and offer.account_id = v_automation.account_id
       and offer.status = 'waiting'
       and offer.captured_at >= v_automation.pilot_reset_at
       and offer.captured_at >= p_now - interval '2 hours'
       and offer.queue_quarantined_at is null
       and offer.error_code is distinct from 'PILOT_QUEUE_QUARANTINED'
       and not exists (select 1 from public.offer_deliveries delivery where delivery.offer_id = offer.id)
     order by offer.captured_at desc, offer.id
     for update skip locked
     limit 1;
    exit when v_offer_id is null;

    begin
      v_result := public.create_pilot_offer_schedule_locked(v_offer_id, p_now);
      if v_result->>'status' = 'scheduled' then v_promoted := v_promoted + 1; end if;
    exception when others then
      update public.captured_offers
         set error_code = 'WAITING_PROMOTION_FAILED',
             error_message = left(sqlerrm, 1000), updated_at = now()
       where id = v_offer_id and status = 'waiting';
      raise warning 'Falha ao promover oferta waiting %: %', v_offer_id, sqlerrm;
      exit;
    end;
    v_offer_id := null;
  end loop;
  return v_promoted;
end;
$function$;

-- Limpa as filas que já estavam paradas.
update public.captured_offers
   set status = 'ignored', error_code = 'QUEUE_EXPIRED',
       error_message = 'Oferta ficou mais de 2 horas na fila sem vaga para envio.', updated_at = now()
 where status = 'waiting'
   and captured_at < now() - interval '2 hours';
