begin;

-- reset_pilot_on_toggle() (20260908165112, corrigido em 20260910105300) filtra
-- offer_deliveries e envios_grupo por (account_id, status) toda vez que uma
-- automação é ligada/desligada. Sem índice para essa combinação, cada
-- desligamento força uma varredura sequencial dessas tabelas, que só crescem
-- (uma linha de offer_deliveries por oferta por grupo de destino). Isso
-- contribui para o consumo crônico de CPU/memória do banco.
create index if not exists offer_deliveries_account_status_idx
  on public.offer_deliveries(account_id, status);
create index if not exists envios_grupo_account_status_idx
  on public.envios_grupo(account_id, status);

commit;
