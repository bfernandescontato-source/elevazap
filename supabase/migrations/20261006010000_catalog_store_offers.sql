-- Catálogo auto-alimentado pela coleta diária da extensão (ofertas do dia das lojas).
-- Global (o catálogo é compartilhado, como o do ML/Shopee). Só a extensão das contas
-- liberadas escreve; todos leem. Amazon e Magalu entram aqui; Shopee segue ao vivo
-- e Mercado Livre segue na sua própria tabela.
create table if not exists public.catalog_store_offers (
  provider text not null check (provider in ('AMAZON','MAGALU','SHOPEE','MERCADO_LIVRE')),
  external_item_id text not null,
  name text not null,
  image_url text,
  price numeric,
  original_price numeric,
  discount_rate numeric,
  sales integer,
  product_url text,
  affiliate_url text,
  coupon text,
  category text,
  captured_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active boolean not null default true,
  primary key (provider, external_item_id)
);
create index if not exists catalog_store_offers_browse on public.catalog_store_offers (provider, active, last_seen_at desc);
