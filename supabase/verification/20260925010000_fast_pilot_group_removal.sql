-- 0) Antes de tudo: compare a versão REAL em produção com a da migration (o banco
--    já divergiu dos arquivos). Se a de produção tiver lógica que a migration não
--    tem, leve essa lógica para a migration antes de aplicar.
select pg_get_functiondef('public.discard_pilot_source_backlog(uuid,uuid,text)'::regprocedure);
select pg_get_functiondef('public.cancel_pending_pilot_destination(uuid,uuid,text)'::regprocedure);

-- Mede quanto tempo leva tirar um grupo fonte e um grupo destino na maior conta
-- (a que dava "statement timeout"), ANTES e DEPOIS da migration, sem gravar nada:
-- tudo acontece dentro de um bloco que termina com raise exception (desfaz tudo).
-- Rodar no SQL Editor do Supabase (papel postgres). Rodar uma vez antes e uma vez
-- depois de aplicar 20260925010000_fast_pilot_group_removal.sql e comparar os ms.
-- Meta: bem abaixo de 8000 ms (limite da API).
do $$
declare
  v_account uuid;
  v_automation uuid;
  v_source text;
  v_destination text;
  v_t0 timestamptz;
  v_ms_source numeric;
  v_ms_destination numeric;
begin
  select account_id, id into v_account, v_automation
    from public.offer_automations a
   order by (select count(*) from public.offer_deliveries d where d.account_id = a.account_id) desc
   limit 1;
  select whatsapp_group_id into v_source from public.automation_source_groups
   where automation_id = v_automation and enabled limit 1;
  select whatsapp_group_id into v_destination from public.automation_destinations
   where automation_id = v_automation and enabled limit 1;

  v_t0 := clock_timestamp();
  delete from public.automation_source_groups where automation_id = v_automation and whatsapp_group_id = v_source;
  v_ms_source := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

  v_t0 := clock_timestamp();
  delete from public.automation_destinations where automation_id = v_automation and whatsapp_group_id = v_destination;
  v_ms_destination := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

  raise exception 'RESULTADO (desfeito): conta=% | remover grupo fonte % = % ms | remover destino % = % ms',
    v_account, v_source, v_ms_source, v_destination, v_ms_destination;
end $$;
