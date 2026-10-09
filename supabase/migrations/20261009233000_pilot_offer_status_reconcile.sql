-- Oferta do Piloto presa em "sending" com todas as entregas já terminadas (09/10/2026).
-- Ocupa uma das 5 vagas do Piloto para sempre (Simone: 3 ofertas de 02/10, 07/10 e 08/10).
-- Uma oferta por chamada; revalida e trava; só mexe se NENHUMA entrega estiver aguardando
-- ou enviando. Não cria, não reenvia e não apaga mensagens.
create or replace function public.reconcile_pilot_offer_status(p_offer_id uuid)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_offer record;
  v_agg record;
  v_status text;
begin
  select id, account_id, status into v_offer
    from public.captured_offers where id = p_offer_id for update skip locked;
  if not found then return 'ocupada ou inexistente'; end if;
  if v_offer.status not in ('scheduled', 'sending') then return 'ja coerente: oferta ' || v_offer.status; end if;
  select count(*)::integer total,
         count(*) filter (where status = 'sent')::integer enviados,
         count(*) filter (where status = 'cancelled')::integer cancelados,
         count(*) filter (where status in ('sent', 'failed', 'uncertain', 'cancelled'))::integer terminais,
         max(sent_at) filter (where status = 'sent') ultimo
    into v_agg
    from public.offer_deliveries where offer_id = v_offer.id and account_id = v_offer.account_id;
  if v_agg.total = 0 or v_agg.terminais < v_agg.total then return 'ainda ha entrega aguardando'; end if;
  v_status := case when v_agg.cancelados = v_agg.total then 'ignored' when v_agg.enviados > 0 then 'sent' else 'send_failed' end;
  update public.captured_offers
     set status = v_status,
         sent_at = case when v_status = 'sent' then coalesce(sent_at, v_agg.ultimo, now()) else sent_at end,
         updated_at = now()
   where id = v_offer.id;
  return 'corrigida: oferta ' || v_offer.status || '->' || v_status;
end;
$function$;

revoke all on function public.reconcile_pilot_offer_status(uuid) from public, anon, authenticated;
