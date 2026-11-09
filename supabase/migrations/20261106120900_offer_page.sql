-- Página de ofertas do aluno ("Minha vitrine"): link público /v/<endereço> para a
-- bio do Instagram com as ofertas que a conta realmente enviou com sucesso.
--
-- Nomes no banco: offer_page_* (e não "vitrine") para não confundir com
-- accounts.extensao_vitrine_enabled, que é outra função (vitrine da extensão).
--
-- Fonte dos dados: envios_grupo com status 'sucesso' é o único registro confiável
-- de "foi enviado" (affiliate_offer_deliveries.status nunca é atualizado). Um
-- gatilho grava UMA linha por produto em offer_page_items quando o envio vira
-- 'sucesso' (por qualquer caminho: fila, conciliação ou resolução manual), e só
-- para contas que já criaram a vitrine. Dados do produto:
--   Catálogo: catalog_scheduled_offers (mesmo lote_id): nome, foto, preço, loja.
--   Piloto:   offer_deliveries -> captured_offers (item_id) só para deduplicar.
--   Texto:    link de compra extraído da mensagem enviada (allowlist de lojas).
-- Nome e preço de ofertas do Piloto/manuais são lidos do texto no servidor web
-- (web/modules/offer-page/offer-text.ts); a página pública só recebe campos
-- públicos. Nunca guardamos grupo, número ou nome de grupo aqui.
--
-- Objetos de produção que esta migration assume existir (conferir antes):
--   tabelas public.accounts(id,status), public.envios_grupo(id,account_id,
--   lote_id,status,texto,legenda,sent_at,resolved_at),
--   public.catalog_scheduled_offers(lote_id,account_id,provider,external_item_id,
--   product_name,image_url,price,original_price,affiliate_url),
--   public.offer_deliveries(group_dispatch_id,account_id,offer_id),
--   public.captured_offers(id,item_id); funções public.current_account_id() e
--   public.current_account_is_active(); papéis authenticated e service_role;
--   índice envios_grupo_account_sent_success_idx (migration anterior).
-- Se catalog_scheduled_offers ou offer_deliveries divergirem, o gatilho cai no
-- bloco de exceção e o envio segue normal (a vitrine só perde aquele item).

begin;

create table if not exists public.offer_page_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  enabled boolean not null default false,
  slug text not null,
  title text not null default '',
  bio text not null default '',
  avatar_path text,
  stores text[] not null default array['SHOPEE','MERCADO_LIVRE','AMAZON','MAGALU']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offer_page_settings_slug_format check (char_length(slug) between 3 and 40 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint offer_page_settings_title_len check (char_length(title) <= 60),
  constraint offer_page_settings_bio_len check (char_length(bio) <= 140),
  constraint offer_page_settings_avatar_len check (avatar_path is null or char_length(avatar_path) <= 500),
  constraint offer_page_settings_stores check (stores <@ array['SHOPEE','MERCADO_LIVRE','AMAZON','MAGALU']::text[])
);
create unique index if not exists offer_page_settings_slug_key on public.offer_page_settings(slug);

create table if not exists public.offer_page_items (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  product_key text not null,
  lote_id uuid,
  store text not null check (store in ('SHOPEE','MERCADO_LIVRE','AMAZON','MAGALU')),
  link text not null check (link ~ '^https://' and char_length(link) <= 1000),
  message text,
  title text,
  price numeric(12,2),
  original_price numeric(12,2),
  image_url text,
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, product_key)
);
create index if not exists offer_page_items_account_sent_idx on public.offer_page_items(account_id, sent_at desc);
create index if not exists offer_page_items_account_lote_idx on public.offer_page_items(account_id, lote_id) where lote_id is not null;

alter table public.offer_page_settings enable row level security;
alter table public.offer_page_items enable row level security;

-- A conta gerencia só a própria vitrine; os itens ela só lê (quem grava é o gatilho).
drop policy if exists tenant_isolation on public.offer_page_settings;
create policy tenant_isolation on public.offer_page_settings for all to authenticated
  using (account_id = (select public.current_account_id()) and (select public.current_account_is_active()))
  with check (account_id = (select public.current_account_id()) and (select public.current_account_is_active()));
drop policy if exists tenant_read on public.offer_page_items;
create policy tenant_read on public.offer_page_items for select to authenticated
  using (account_id = (select public.current_account_id()) and (select public.current_account_is_active()));

revoke all on public.offer_page_settings from anon;
revoke all on public.offer_page_items from anon;
revoke insert, update, delete on public.offer_page_items from authenticated;

-- Loja pelo endereço do link (mesma allowlist de web/modules/offer-page/offer-text.ts).
create or replace function public.offer_page_store_of(p_url text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case
    when h is null then null
    when h ~ '(^|\.)shopee\.com\.br$' or h in ('shp.ee','shope.ee') then 'SHOPEE'
    when h ~ '(^|\.)mercadolivre\.com\.br$' or h = 'meli.la' then 'MERCADO_LIVRE'
    when h ~ '(^|\.)amazon\.com\.br$' or h in ('amzn.to','a.co','link.amazon','amzlink.me','amzlinks.in','amzn.divulgador.link') then 'AMAZON'
    when h ~ '(^|\.)(magazinevoce|magazineluiza)\.com\.br$' or h ~ '(^|\.)magalu\.com$' then 'MAGALU'
    else null end
  from (select lower(substring(p_url from '^https://([^/:?#[:space:]]+)')) as h) host
$$;

-- Primeiro link https de loja conhecida no texto enviado.
create or replace function public.offer_page_link(p_text text) returns text
language sql immutable set search_path = pg_catalog, public as $$
  select url from (
    select regexp_replace(match[1], '[),.!?;:*_~]+$', '') as url, position
    from regexp_matches(coalesce(p_text, ''), '(https://[^[:space:]<>"'']+)', 'g') with ordinality as found(match, position)
  ) candidates
  where public.offer_page_store_of(url) is not null
  order by position limit 1
$$;

-- Registra um envio com sucesso na vitrine da conta (um item por produto).
create or replace function public.offer_page_record_dispatch(
  p_account_id uuid, p_dispatch_id uuid, p_lote_id uuid, p_message text, p_sent_at timestamptz
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_link text := public.offer_page_link(p_message);
  v_store text;
  v_key text;
  v_item_id text;
  c_provider text; c_item text; c_name text; c_image text; c_price numeric; c_original numeric; c_url text;
begin
  if p_account_id is null then return false; end if;
  -- O mesmo lote vai para vários grupos: só o primeiro sucesso grava (sem disputar a linha).
  if p_lote_id is not null and exists (
    select 1 from public.offer_page_items i where i.account_id = p_account_id and i.lote_id = p_lote_id
  ) then return false; end if;

  if p_lote_id is not null then
    select c.provider, c.external_item_id, c.product_name, c.image_url, c.price, c.original_price, c.affiliate_url
      into c_provider, c_item, c_name, c_image, c_price, c_original, c_url
      from public.catalog_scheduled_offers c
     where c.lote_id = p_lote_id and c.account_id = p_account_id
     limit 1;
  end if;

  if c_provider is not null then
    v_link := coalesce(v_link, case when c_url ~ '^https://' then c_url end);
    v_store := coalesce(public.offer_page_store_of(v_link), case when c_provider in ('SHOPEE','MERCADO_LIVRE','AMAZON','MAGALU') then c_provider end);
    v_key := 'item:' || c_provider || ':' || c_item;
  else
    if v_link is null then return false; end if; -- mensagem sem link de loja: não é oferta
    v_store := public.offer_page_store_of(v_link);
    select co.item_id into v_item_id
      from public.offer_deliveries d join public.captured_offers co on co.id = d.offer_id
     where d.group_dispatch_id = p_dispatch_id and d.account_id = p_account_id and co.item_id is not null
     limit 1;
    v_key := case when v_item_id is not null then 'item:' || v_store || ':' || v_item_id else 'link:' || md5(v_link) end;
  end if;
  if v_link is null or v_store is null or char_length(v_link) > 1000 then return false; end if;

  insert into public.offer_page_items as item (account_id, product_key, lote_id, store, link, message, title, price, original_price, image_url, sent_at)
  values (
    p_account_id, v_key, p_lote_id, v_store, v_link, left(p_message, 4000),
    left(c_name, 300), c_price, c_original,
    case when c_image ~ '^https://' then left(c_image, 1000) end,
    coalesce(p_sent_at, now())
  )
  on conflict (account_id, product_key) do update set
    lote_id = excluded.lote_id, store = excluded.store, link = excluded.link, message = excluded.message,
    title = excluded.title, price = excluded.price, original_price = excluded.original_price,
    image_url = excluded.image_url, sent_at = excluded.sent_at, updated_at = now()
  where item.sent_at < excluded.sent_at;
  return true;
end $$;

create or replace function public.offer_page_on_dispatch_sent() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  -- Só contas que criaram a vitrine (busca pela chave primária).
  if not exists (select 1 from public.offer_page_settings s where s.account_id = new.account_id) then return null; end if;
  begin
    perform public.offer_page_record_dispatch(new.account_id, new.id, new.lote_id, coalesce(new.texto, new.legenda), coalesce(new.sent_at, new.resolved_at, now()));
  exception when others then
    -- A vitrine nunca pode desfazer a confirmação de um envio.
    raise warning 'offer_page_on_dispatch_sent: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end $$;

drop trigger if exists offer_page_dispatch_sent on public.envios_grupo;
create trigger offer_page_dispatch_sent
  after update of status on public.envios_grupo
  for each row
  when (new.status = 'sucesso' and old.status is distinct from 'sucesso')
  execute function public.offer_page_on_dispatch_sent();

-- Carga inicial de UMA conta, em lotes curtos (bem abaixo dos 8 s do PostgREST).
-- Percorre os envios com sucesso dos últimos 30 dias do mais novo ao mais antigo.
-- Chamar de novo com next_sent_at/next_id até done = true.
create or replace function public.offer_page_backfill_account(
  p_account_id uuid, p_before_sent_at timestamptz default null, p_before_id uuid default null, p_limit integer default 300
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 500);
  v_cursor_at timestamptz := coalesce(p_before_sent_at, 'infinity'::timestamptz);
  v_cursor_id uuid := coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
  v_since timestamptz := now() - interval '30 days';
  v_scanned integer := 0;
  v_recorded integer := 0;
  v_last_at timestamptz;
  v_last_id uuid;
  v_last_lote uuid;
  r record;
begin
  if p_account_id is null or not exists (select 1 from public.offer_page_settings s where s.account_id = p_account_id) then
    return jsonb_build_object('scanned', 0, 'recorded', 0, 'done', true);
  end if;
  for r in
    select e.id, e.lote_id, e.texto, e.legenda, e.sent_at
      from public.envios_grupo e
     where e.account_id = p_account_id and e.status = 'sucesso'
       and e.sent_at >= v_since and (e.sent_at, e.id) < (v_cursor_at, v_cursor_id)
     order by e.sent_at desc, e.id desc
     limit v_limit
  loop
    v_scanned := v_scanned + 1;
    v_last_at := r.sent_at; v_last_id := r.id;
    -- Linhas do mesmo lote chegam juntas; basta o envio mais recente de cada lote.
    if r.lote_id is not null and r.lote_id = v_last_lote then continue; end if;
    v_last_lote := r.lote_id;
    begin
      if public.offer_page_record_dispatch(p_account_id, r.id, r.lote_id, coalesce(r.texto, r.legenda), r.sent_at) then
        v_recorded := v_recorded + 1;
      end if;
    exception when others then
      raise warning 'offer_page_backfill_account: % (%)', sqlerrm, sqlstate;
    end;
  end loop;
  return jsonb_build_object(
    'scanned', v_scanned, 'recorded', v_recorded, 'done', v_scanned < v_limit,
    'next_sent_at', v_last_at, 'next_id', v_last_id
  );
end $$;

-- Leitura pública: só vitrines ligadas de contas ativas, só campos públicos.
-- Não devolve account_id, grupos nem números. Chamado pelo servidor web.
create or replace function public.offer_page_public(p_slug text, p_limit integer default 200) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'slug', s.slug, 'title', s.title, 'bio', s.bio, 'avatar_path', s.avatar_path, 'stores', to_jsonb(s.stores),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_key', i.product_key, 'store', i.store, 'link', i.link, 'message', i.message, 'title', i.title,
        'price', i.price, 'original_price', i.original_price, 'image_url', i.image_url, 'sent_at', i.sent_at
      ) order by i.sent_at desc)
      from (
        select * from public.offer_page_items i
         where i.account_id = s.account_id and i.sent_at >= now() - interval '30 days' and i.store = any(s.stores)
         order by i.sent_at desc
         limit least(greatest(coalesce(p_limit, 200), 1), 300)
      ) i
    ), '[]'::jsonb)
  )
  from public.offer_page_settings s
  join public.accounts a on a.id = s.account_id and a.status = 'active'
  where s.slug = lower(p_slug) and s.enabled
$$;

-- Limpeza opcional de itens com mais de 30 dias, em lotes (rodar até devolver 0).
create or replace function public.offer_page_prune(p_limit integer default 1000) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare removed integer;
begin
  delete from public.offer_page_items where id in (
    select id from public.offer_page_items where sent_at < now() - interval '35 days'
     limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
  );
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function public.offer_page_store_of(text) from public, anon, authenticated;
revoke all on function public.offer_page_link(text) from public, anon, authenticated;
revoke all on function public.offer_page_record_dispatch(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.offer_page_on_dispatch_sent() from public, anon, authenticated;
revoke all on function public.offer_page_backfill_account(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.offer_page_public(text, integer) from public, anon, authenticated;
revoke all on function public.offer_page_prune(integer) from public, anon, authenticated;
grant execute on function public.offer_page_backfill_account(uuid, timestamptz, uuid, integer) to service_role;
grant execute on function public.offer_page_public(text, integer) to service_role;
grant execute on function public.offer_page_prune(integer) to service_role;

notify pgrst, 'reload schema';

commit;
