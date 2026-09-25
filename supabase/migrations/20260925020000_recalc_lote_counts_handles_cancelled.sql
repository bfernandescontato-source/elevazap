-- Lotes de disparo ficavam "pendente" para sempre quando tinham envios cancelados ou
-- pausados: a versão de produção de recalc_lote_counts não conhecia esses status e,
-- sem pendentes nem "enviados + erros = total", mantinha o status antigo. Em
-- 25/09/2026 eram 15.683 lotes "pendente" sem nenhum envio ativo, que também
-- seguravam as mídias deles (a limpeza de mídia preserva lotes "pendente").
--
-- Mesma assinatura e mesmas colunas da versão de produção (que não tem as colunas
-- cancelados/pausados de 013); só a regra de status passa a considerar cancelado e
-- pausado. Depois de aplicar, recalcular os lotes presos em blocos (ver o fim).

begin;

create or replace function public.recalc_lote_counts(p_lote_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c record;
begin
  select
    count(*)::int as total,
    count(*) filter (where status = 'sucesso')::int as enviados,
    count(*) filter (where status = 'erro')::int as erros,
    count(*) filter (where status = 'pendente')::int as pendentes,
    count(*) filter (where status = 'enfileirado')::int as enfileirados,
    count(*) filter (where status = 'processando')::int as processando,
    count(*) filter (where status = 'incerto')::int as incertos,
    count(*) filter (where status = 'pausado')::int as pausados,
    count(*) filter (where status = 'cancelado')::int as cancelados
  into c
  from envios_grupo
  where lote_id = p_lote_id;

  update envios_grupo_lotes
  set total = c.total,
      enviados = c.enviados,
      erros = c.erros,
      pendentes = c.pendentes,
      enfileirados = c.enfileirados,
      processando = c.processando,
      incertos = c.incertos,
      status = case
        when c.incertos > 0 then 'incerto'
        when c.processando > 0 or c.enfileirados > 0 then 'processando'
        when c.pendentes > 0 then 'pendente'
        when c.pausados > 0 then 'pausado'
        when c.total > 0 and c.cancelados = c.total then 'cancelado'
        when c.total > 0 and c.enviados + c.erros + c.cancelados = c.total and c.enviados = 0 then 'erro'
        when c.total > 0 and c.enviados + c.erros + c.cancelados = c.total then 'sucesso'
        else status
      end,
      finished_at = case
        when c.total > 0 and c.enviados + c.erros + c.cancelados = c.total then coalesce(finished_at, now())
        else finished_at
      end,
      updated_at = now()
  where id = p_lote_id;
end;
$function$;

commit;

-- Recalcular os lotes presos (rodar depois, em blocos; cada execução trata até 3.000):
-- do $$ declare v uuid; begin
--   for v in select l.id from public.envios_grupo_lotes l
--             where l.status = 'pendente'
--               and not exists (select 1 from public.envios_grupo e where e.lote_id = l.id
--                                 and e.status in ('pendente','enfileirado','processando','pausado','incerto'))
--             limit 3000
--   loop perform public.recalc_lote_counts(v); end loop;
-- end $$;
