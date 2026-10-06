-- Comissão no catálogo das lojas coletadas (Amazon). A Amazon não expõe comissão por
-- produto; usamos a estimativa por categoria (tabela de comissão da Amazon), marcada.
alter table public.catalog_store_offers add column if not exists commission_rate numeric;
alter table public.catalog_store_offers add column if not exists commission_value numeric;
alter table public.catalog_store_offers add column if not exists commission_estimated boolean not null default false;
