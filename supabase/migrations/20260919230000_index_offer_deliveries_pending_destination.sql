-- Remover um grupo destino do Piloto dispara cancel_pending_pilot_destination, que
-- procura as entregas pendentes daquele grupo. Sem um índice começando por
-- destination_group_id, o banco varria o índice inteiro de offer_deliveries
-- (~300 mil linhas): 4,5 s a frio por grupo removido, o que estourava o
-- statement_timeout de 8 s do PostgREST e desfazia o salvamento inteiro
-- (a tela mostrava os grupos "voltando"). Com este índice parcial (só as
-- entregas pending/scheduled, poucas centenas) o mesmo passo leva 0,18 ms.
--
-- Já foi criado em produção com CONCURRENTLY; aqui fica idempotente para
-- ambientes novos.
create index if not exists offer_deliveries_pending_destination_idx
  on public.offer_deliveries (destination_group_id, account_id)
  where status in ('pending', 'scheduled');
