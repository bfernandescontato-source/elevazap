-- Página de ofertas do aluno (vitrine pública): índice para a carga inicial.
--
-- A carga inicial (public.offer_page_backfill_account) percorre os envios com
-- sucesso dos últimos 30 dias de UMA conta, do mais novo para o mais antigo, em
-- lotes curtos. Sem este índice cada lote varreria todos os envios com sucesso
-- da conta (a maior tem ~150 mil) para ordenar por sent_at.
--
-- CONCURRENTLY não trava a fila de envios; por isso este arquivo fica fora de
-- transação e separado da migration principal. Aplicar ANTES de
-- 20261106120900_offer_page.sql.

create index concurrently if not exists envios_grupo_account_sent_success_idx
  on public.envios_grupo(account_id, sent_at desc, id desc)
  where status = 'sucesso';
