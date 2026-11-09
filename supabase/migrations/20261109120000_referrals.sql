-- Indique e ganhe: código de indicação por conta, indicações vindas da Hubla,
-- chave PIX do aluno e pagamentos feitos à mão pela dona.
-- Aditiva e idempotente. Não gera código para contas existentes: o código é
-- criado sob demanda quando o aluno abre a tela /indique (evita reescrever
-- todas as contas numa instrução só).

create table if not exists public.referral_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  code text not null,
  pix_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_profiles_code_format check (code ~ '^[A-Z0-9]{4,12}$'),
  constraint referral_profiles_pix_key_length check (pix_key is null or char_length(pix_key) <= 140)
);
create unique index if not exists referral_profiles_code_key on public.referral_profiles (code);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_account_id uuid not null references public.accounts(id) on delete cascade,
  referred_account_id uuid not null references public.accounts(id) on delete cascade,
  referral_code text not null,
  referred_first_name text,
  status text not null default 'pending',
  source_event text,
  source_idempotency_key text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referrals_status_check check (status in ('pending', 'paying', 'refunded')),
  constraint referrals_not_self check (referrer_account_id <> referred_account_id)
);
create unique index if not exists referrals_referred_account_key on public.referrals (referred_account_id);
create index if not exists referrals_referrer_status_idx on public.referrals (referrer_account_id, status);

create table if not exists public.referral_payouts (
  id uuid primary key default gen_random_uuid(),
  referrer_account_id uuid not null references public.accounts(id) on delete cascade,
  amount_cents integer not null,
  paid_at timestamptz not null default now(),
  note text,
  created_by_email text,
  created_at timestamptz not null default now(),
  constraint referral_payouts_amount_positive check (amount_cents > 0),
  constraint referral_payouts_note_length check (note is null or char_length(note) <= 300)
);
create index if not exists referral_payouts_referrer_idx on public.referral_payouts (referrer_account_id, paid_at desc);

alter table public.referral_profiles enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_payouts enable row level security;

-- O navegador nunca escreve código, indicação ou pagamento. Só lê o que é da
-- própria conta e só altera a chave PIX. Webhook e admin usam service_role
-- com filtro explícito de conta.
revoke all on public.referral_profiles from anon, authenticated;
revoke all on public.referrals from anon, authenticated;
revoke all on public.referral_payouts from anon, authenticated;

grant select (account_id, code, pix_key, created_at, updated_at) on public.referral_profiles to authenticated;
grant update (pix_key, updated_at) on public.referral_profiles to authenticated;
-- Indicado aparece só com primeiro nome, data e status (sem e-mail nem conta).
grant select (id, referrer_account_id, referred_first_name, status, created_at, paid_at, refunded_at) on public.referrals to authenticated;
grant select (id, referrer_account_id, amount_cents, paid_at, created_at) on public.referral_payouts to authenticated;

drop policy if exists referral_profiles_read_own on public.referral_profiles;
create policy referral_profiles_read_own on public.referral_profiles for select to authenticated
  using (account_id = (select public.current_account_id()) and (select public.current_account_is_active()));

drop policy if exists referral_profiles_update_own on public.referral_profiles;
create policy referral_profiles_update_own on public.referral_profiles for update to authenticated
  using (account_id = (select public.current_account_id()) and (select public.current_account_is_active()))
  with check (account_id = (select public.current_account_id()) and (select public.current_account_is_active()));

drop policy if exists referrals_read_own on public.referrals;
create policy referrals_read_own on public.referrals for select to authenticated
  using (referrer_account_id = (select public.current_account_id()) and (select public.current_account_is_active()));

drop policy if exists referral_payouts_read_own on public.referral_payouts;
create policy referral_payouts_read_own on public.referral_payouts for select to authenticated
  using (referrer_account_id = (select public.current_account_id()) and (select public.current_account_is_active()));

grant all on public.referral_profiles to service_role;
grant all on public.referrals to service_role;
grant all on public.referral_payouts to service_role;
