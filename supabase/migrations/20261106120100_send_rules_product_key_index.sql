-- Índice da regra "produto repetido" (consulta por conta + grupo + produto + horário).
-- Parcial: só envios com product_key (nascem a partir de 20261106120000), então ele
-- começa vazio e cresce devagar.
--
-- RODAR SOZINHO, fora de transação (CONCURRENTLY não roda dentro de begin/commit),
-- depois da migration 20261106120000. Não bloqueia gravações na fila.
-- Sem ele a regra funciona, só que a busca cai no índice de group_jid.
create index concurrently if not exists envios_grupo_product_repeat_idx
  on public.envios_grupo (account_id, group_jid, product_key, scheduled_at)
  where product_key is not null;
