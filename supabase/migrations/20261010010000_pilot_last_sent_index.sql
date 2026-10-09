-- Índice para "último envio do Piloto" (09/10/2026). APLICADO em produção às 20h44 BRT com CONCURRENTLY.
-- compact_pilot_schedule_locked e a sincronização das entregas calculam max(sent_at) das ofertas
-- enviadas do Piloto. Num Piloto com 67.852 ofertas isso lia ~5,5 mil linhas espalhadas (693 ms;
-- segundos sob carga) e fazia a reorganização passar do limite de 8 s. Com o índice: 4 ms.
-- Rodar fora de transação (CONCURRENTLY não bloqueia gravações). Reversão:
--   drop index concurrently if exists public.captured_offers_pilot_last_sent_idx;
create index concurrently if not exists captured_offers_pilot_last_sent_idx
  on public.captured_offers (automation_id, sent_at desc)
  where status = 'sent' and sent_at is not null;
