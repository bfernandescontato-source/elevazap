-- Ganchos do aluno: lista própria de ganchos (primeira linha da copy de oferta)
-- e o modo de uso por conta. Vale para o Catálogo (gerar mensagem e agenda) e
-- para o Piloto Automático. Sem linha de configuração = modo "system" (a lista
-- aprovada do sistema, como sempre foi).
--
-- Idempotente. Depende de public.accounts, public.current_account_id() e
-- public.current_account_is_active() (015_multi_tenant_accounts.sql).

create table if not exists public.account_offer_hooks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 80 and strpos(text, E'\n') = 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists account_offer_hooks_account_idx on public.account_offer_hooks (account_id, position, created_at);

create table if not exists public.account_offer_hook_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  mode text not null default 'system' check (mode in ('system','own_sequence','own_random','fixed','ai')),
  mix_system boolean not null default false,
  fixed_hook_id uuid references public.account_offer_hooks(id) on delete set null,
  -- Contador do modo "em ordem". Só muda pela função abaixo (update atômico).
  sequence_counter bigint not null default 0 check (sequence_counter >= 0),
  updated_at timestamptz not null default now()
);

alter table public.account_offer_hooks enable row level security;
alter table public.account_offer_hook_settings enable row level security;

drop policy if exists tenant_isolation on public.account_offer_hooks;
create policy tenant_isolation on public.account_offer_hooks for all to authenticated
  using (account_id = public.current_account_id() and public.current_account_is_active())
  with check (account_id = public.current_account_id() and public.current_account_is_active());

drop policy if exists tenant_isolation on public.account_offer_hook_settings;
create policy tenant_isolation on public.account_offer_hook_settings for all to authenticated
  using (account_id = public.current_account_id() and public.current_account_is_active())
  with check (account_id = public.current_account_id() and public.current_account_is_active());

revoke all on public.account_offer_hooks from anon;
revoke all on public.account_offer_hook_settings from anon;

-- Reserva p_count posições seguidas do contador "em ordem" e devolve a primeira.
-- Um único upsert por chamada: seguro com envios simultâneos e bem abaixo do
-- limite de 8 s do PostgREST. Só o backend (service_role) chama.
create or replace function public.reserve_offer_hook_sequence(p_account_id uuid, p_count integer default 1)
returns bigint
language sql
volatile
set search_path = public
as $$
  insert into public.account_offer_hook_settings as s (account_id, sequence_counter)
  values (p_account_id, greatest(1, least(coalesce(p_count, 1), 100)))
  on conflict (account_id) do update
    set sequence_counter = s.sequence_counter + greatest(1, least(coalesce(p_count, 1), 100))
  returning sequence_counter - greatest(1, least(coalesce(p_count, 1), 100));
$$;

revoke all on function public.reserve_offer_hook_sequence(uuid, integer) from public;
revoke all on function public.reserve_offer_hook_sequence(uuid, integer) from anon, authenticated;
grant execute on function public.reserve_offer_hook_sequence(uuid, integer) to service_role;
