-- Corrige a idempotência de official_events: em um índice único padrão, NULLs não são
-- considerados iguais entre si. Manter event_type na chave permitiria duplicatas sempre
-- que o tipo do evento da Hubla não puder ser identificado (fase 2 é modo de captura,
-- sem parser ainda). A garantia real de idempotência é só provider + provider_event_id.
drop index if exists public.official_events_idempotency_idx;
create unique index if not exists official_events_idempotency_idx
  on public.official_events(provider, provider_event_id)
  where provider_event_id is not null;
