-- Imagem das ofertas por conta: formato padrão (Imagem ou Preview do link) e
-- selos na foto ("-52%", "FRETE GRÁTIS").
--
-- Objetos de produção que esta migration assume existir:
--   public.accounts(id)
--   auth.users(id)
--   public.affiliate_offer_deliveries (tabela do histórico do Catálogo)
--   public.current_account_id() e public.current_account_is_active()
--
-- Idempotente: pode rodar de novo sem erro. Sem a migration, o painel e o
-- whatsapp-service seguem como antes (sem selos, formato Imagem).

begin;

create table if not exists public.offer_image_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  default_image_mode text not null default 'original_image',
  discount_badge_enabled boolean not null default false,
  free_shipping_badge_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'offer_image_settings_default_image_mode_check'
      and conrelid = 'public.offer_image_settings'::regclass
  ) then
    alter table public.offer_image_settings
      add constraint offer_image_settings_default_image_mode_check
      check (default_image_mode in ('original_image', 'product_link_preview'));
  end if;
end $$;

alter table public.offer_image_settings enable row level security;

-- O painel grava pelo backend (service_role com filtro de conta); o aluno só lê a da conta dele.
drop policy if exists tenant_read on public.offer_image_settings;
create policy tenant_read on public.offer_image_settings for select to authenticated
  using (account_id = public.current_account_id() and public.current_account_is_active());

-- Selos decididos no envio do Catálogo, lidos pelo whatsapp-service ao montar o card.
-- Formato: {"discountPercent": 52, "freeShipping": true}; nulo = sem selo.
alter table public.affiliate_offer_deliveries
  add column if not exists image_badges jsonb;

notify pgrst, 'reload schema';
commit;
