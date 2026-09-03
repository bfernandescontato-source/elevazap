begin;

alter table public.mercado_livre_products
  add column if not exists extra_earnings boolean not null default false,
  add column if not exists extra_commission_rate numeric(8,4),
  add column if not exists extra_commission_value numeric(14,2),
  add column if not exists badges jsonb not null default '[]'::jsonb,
  add column if not exists source_page text;

alter table public.mercado_livre_products
  add constraint mercado_livre_products_badges_array_check
  check (jsonb_typeof(badges) = 'array');

notify pgrst, 'reload schema';
commit;
