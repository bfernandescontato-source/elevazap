-- A Hubla reutiliza IDs terminados em "-tester" entre testes de produtos diferentes.
-- Uma compra real continua única por provider + invoice ID + produto/oferta, enquanto
-- um teste da Shop Lab não fica bloqueado por um teste anterior de Achadinhos.
drop index if exists public.official_events_idempotency_idx;
create unique index official_events_idempotency_idx
  on public.official_events(provider, provider_event_id, (coalesce(product_id, '')))
  where provider_event_id is not null;
