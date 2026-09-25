-- Índices por conta + situação. Aplicados em produção em 25/09/2026 (CONCURRENTLY,
-- sem travar escrita; por isso fora de transação).
--
-- Medido na maior conta (147 mil envios):
--   Início (/api/dashboard/summary) contava envios por situação varrendo a conta
--   inteira: 9.703 ms por contagem (passava do limite de 8 s) -> 22 ms.
--   Contagens de ofertas do Piloto por situação: 86 ms -> 0,4 ms.
-- O índice de lotes por conta e data atende as listas de disparos (mais recentes primeiro).

create index concurrently if not exists envios_grupo_account_status_idx on public.envios_grupo(account_id, status);
create index concurrently if not exists envios_account_status_idx on public.envios(account_id, status);
create index concurrently if not exists envios_grupo_lotes_account_created_idx on public.envios_grupo_lotes(account_id, created_at desc);
create index concurrently if not exists captured_offers_account_status_idx on public.captured_offers(account_id, status);
