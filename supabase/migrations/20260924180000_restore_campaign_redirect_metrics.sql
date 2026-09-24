-- Restaura o que falta em produção para os links de campanha (/c/<slug>).
--
-- A migration 013 nunca foi aplicada por inteiro: em 24/09/2026 o banco de
-- produção tinha campanhas.total_accesses/total_redirects, mas não tinha
-- campanhas.public_rate_limit_per_minute nem a tabela
-- campaign_redirect_daily_metrics. Por isso resolve_campaign_redirect falha em
-- 100% das chamadas e o redirecionamento cai no caminho alternativo, sem
-- métrica de clique nem limite contra abuso.
--
-- resolve_campaign_redirect (20260917210000) grava a métrica diária sem
-- account_id; o trigger abaixo preenche a partir da campanha para manter o
-- isolamento por conta (RLS) igual às outras tabelas.
--
-- NÃO é aplicada automaticamente. Antes de aplicar: conferir o esquema real e
-- rodar a verificação em transação desfeita
-- (supabase/verification/20260924180000_restore_campaign_redirect_metrics.sql).
-- Depois de aplicar, cada clique passa a gravar em campanhas (linha quente) e
-- em campaign_redirect_daily_metrics: testar carga antes de divulgar em massa.

begin;

alter table public.campanhas
  add column if not exists public_rate_limit_per_minute integer not null default 120;

do $$ begin
  alter table public.campanhas add constraint campanhas_public_rate_limit_check
    check (public_rate_limit_per_minute between 10 and 10000);
exception when duplicate_object then null;
end $$;

create table if not exists public.campaign_redirect_daily_metrics (
  campaign_id uuid not null references public.campanhas(id) on delete cascade,
  day date not null,
  source text not null default 'Sem UTM',
  result text not null,
  total bigint not null default 0,
  account_id uuid references public.accounts(id) on delete restrict,
  primary key (campaign_id, day, source, result)
);

create or replace function public.set_campaign_redirect_metric_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.account_id is null then
    select c.account_id into new.account_id from public.campanhas c where c.id = new.campaign_id;
  end if;
  if new.account_id is null then
    raise exception 'Campanha % sem conta para a métrica.', new.campaign_id using errcode = '23502';
  end if;
  return new;
end;
$$;

revoke all on function public.set_campaign_redirect_metric_account() from public, anon, authenticated;

drop trigger if exists campaign_redirect_daily_metrics_account on public.campaign_redirect_daily_metrics;
create trigger campaign_redirect_daily_metrics_account
  before insert on public.campaign_redirect_daily_metrics
  for each row execute function public.set_campaign_redirect_metric_account();

create index if not exists campaign_redirect_daily_metrics_account_id_idx
  on public.campaign_redirect_daily_metrics(account_id);

alter table public.campaign_redirect_daily_metrics enable row level security;
drop policy if exists tenant_isolation on public.campaign_redirect_daily_metrics;
create policy tenant_isolation on public.campaign_redirect_daily_metrics for all to authenticated
  using (account_id = public.current_account_id() and public.current_account_is_active())
  with check (account_id = public.current_account_id() and public.current_account_is_active());

commit;
