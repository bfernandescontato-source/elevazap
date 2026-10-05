-- Vitrine da extensão (carrinho nas lojas ML/Amazon/Shopee/Magalu → Catálogo/Agenda).
-- Liberação gradual por conta: nasce desligada para todas; liga-se à mão nas contas de teste.
alter table public.accounts add column if not exists extensao_vitrine_enabled boolean not null default false;

-- Magalu entra como marketplace do Catálogo (link da loja Magazine Você do afiliado).
alter table public.catalog_scheduled_offers drop constraint if exists catalog_scheduled_offers_provider_check;
alter table public.catalog_scheduled_offers add constraint catalog_scheduled_offers_provider_check
  check (provider in ('SHOPEE','MERCADO_LIVRE','AMAZON','TIKTOK_SHOP','MAGALU'));
alter table public.affiliate_offer_deliveries drop constraint if exists affiliate_offer_deliveries_provider_check;
alter table public.affiliate_offer_deliveries add constraint affiliate_offer_deliveries_provider_check
  check (provider in ('SHOPEE','MERCADO_LIVRE','AMAZON','TIKTOK_SHOP','MAGALU'));
