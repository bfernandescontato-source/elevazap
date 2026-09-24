-- Dry run de 20260924180000_restore_campaign_redirect_metrics.sql: aplica o
-- esquema, simula um clique real numa campanha ativa e desfaz tudo. O
-- resultado vem na mensagem de erro "RESULTADO: ..." e nada é gravado.
-- Rodar no SQL Editor do Supabase (papel postgres).
do $$
declare
  v_campaign record;
  v_result jsonb;
  v_metric record;
  v_started timestamptz := clock_timestamp();
begin
  alter table public.campanhas
    add column if not exists public_rate_limit_per_minute integer not null default 120;

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
  returns trigger language plpgsql security definer set search_path = pg_catalog, public as $f$
  begin
    if new.account_id is null then
      select c.account_id into new.account_id from public.campanhas c where c.id = new.campaign_id;
    end if;
    return new;
  end;
  $f$;
  create trigger campaign_redirect_daily_metrics_account
    before insert on public.campaign_redirect_daily_metrics
    for each row execute function public.set_campaign_redirect_metric_account();

  select id, slug, account_id into v_campaign from public.campanhas
   where slug is not null order by updated_at desc limit 1;
  if v_campaign.id is null then raise exception 'RESULTADO: nenhuma campanha com slug para testar'; end if;

  -- Mesma chamada do web/app/c/[slug]/route.ts; se a assinatura divergir, o erro mostra a real.
  select public.resolve_campaign_redirect(
    p_slug => v_campaign.slug, p_utm => '{"utm_source":"teste-rollback"}'::jsonb,
    p_user_agent => 'verificacao', p_anonymous_session_id => 'verificacao-rollback'
  ) into v_result;

  select * into v_metric from public.campaign_redirect_daily_metrics
   where campaign_id = v_campaign.id and day = current_date order by total desc limit 1;

  raise exception 'RESULTADO: campanha=% resposta=% metrica_account_ok=% total=% ms=%',
    v_campaign.slug, v_result, v_metric.account_id = v_campaign.account_id, v_metric.total,
    round(extract(epoch from clock_timestamp() - v_started) * 1000);
end $$;
