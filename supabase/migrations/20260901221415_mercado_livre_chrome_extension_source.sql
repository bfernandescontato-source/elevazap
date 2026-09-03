begin;

alter table public.mercado_livre_products
  add column if not exists source text not null default 'chrome_extension',
  add column if not exists captured_at timestamptz,
  add column if not exists last_seen_at timestamptz;

alter table public.mercado_livre_products
  drop constraint if exists mercado_livre_products_source_check;
alter table public.mercado_livre_products
  add constraint mercado_livre_products_source_check check (source in ('chrome_extension'));

update public.mercado_livre_products
set source = 'chrome_extension',
    captured_at = coalesce(captured_at, last_synced_at, created_at),
    last_seen_at = coalesce(last_seen_at, last_synced_at, updated_at)
where captured_at is null or last_seen_at is null;

alter table public.mercado_livre_products
  alter column captured_at set default now(),
  alter column captured_at set not null,
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null;

create index if not exists mercado_livre_products_last_seen_idx
  on public.mercado_livre_products (source, last_seen_at desc);

notify pgrst, 'reload schema';
commit;
