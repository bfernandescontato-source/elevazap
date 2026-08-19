begin;

create table public.mercado_livre_platform_integration (
  id integer primary key default 1,
  status text not null default 'disconnected'
    check (status in ('disconnected','connecting','connected','reauthorization_required','error')),
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  mercado_livre_user_id text,
  scope text,
  connected_by_email text,
  connected_at timestamptz,
  last_refreshed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercado_livre_platform_integration_singleton check (id = 1)
);

insert into public.mercado_livre_platform_integration (id, status) values (1, 'disconnected') on conflict (id) do nothing;

comment on table public.mercado_livre_platform_integration is
  'Integração OAuth única, central, administrada pela Disparei, para navegação do catálogo Mercado Livre. NÃO é affiliate_integrations (provider=mercado_livre) — aquela é por conta/tenant via extensão, gera links meli.la. Mecanismos distintos, não misturar.';

alter table public.mercado_livre_platform_integration enable row level security;
-- Nenhuma policy criada de propósito: sem acesso para authenticated/anon, só service role.

notify pgrst, 'reload schema';
commit;
