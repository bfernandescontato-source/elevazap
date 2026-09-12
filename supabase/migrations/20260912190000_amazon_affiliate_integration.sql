begin;

-- Amazon usa somente o Partner Tag. A conversao manual e o Piloto compartilham
-- a mesma logica; nao ha catalogo, API de produtos ou fila separada.
alter table public.affiliate_integrations
  drop constraint if exists affiliate_integrations_provider_check;

alter table public.affiliate_integrations
  add constraint affiliate_integrations_provider_check
  check (provider in ('shopee','mercado_livre','amazon'));

alter table public.captured_offers
  add column if not exists amazon_links jsonb not null default '[]'::jsonb;

alter table public.captured_offers
  drop constraint if exists captured_offers_affiliate_provider_check;

alter table public.captured_offers
  add constraint captured_offers_affiliate_provider_check
  check (affiliate_provider is null or affiliate_provider in ('shopee','mercado_livre','amazon','multiple'));

commit;
