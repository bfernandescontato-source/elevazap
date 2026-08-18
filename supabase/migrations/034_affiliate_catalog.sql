begin;
create table public.affiliate_offer_deliveries (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null, provider text not null check (provider in ('SHOPEE','MERCADO_LIVRE','AMAZON','TIKTOK_SHOP')),
  external_item_id text not null, group_id text not null, sender_id uuid references public.whatsapp_senders(id) on delete set null,
  group_dispatch_id uuid references public.envios_grupo(id) on delete set null, scheduled_at timestamptz, sent_at timestamptz,
  message text not null, affiliate_url text, status text not null default 'pending', created_at timestamptz not null default now()
);
create index affiliate_offer_history_idx on public.affiliate_offer_deliveries(account_id, provider, external_item_id, group_id, created_at desc);
alter table public.affiliate_offer_deliveries enable row level security;
create policy tenant_isolation on public.affiliate_offer_deliveries for all to authenticated using (account_id=public.current_account_id() and public.current_account_is_active()) with check (account_id=public.current_account_id() and public.current_account_is_active());
notify pgrst, 'reload schema';
commit;
