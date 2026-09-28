-- Nichos de produto (Catálogo e, depois, segmentação do Piloto).
-- Nicho novo = uma linha nesta tabela; a aplicação lê daqui (sem deploy).
-- shopee_category_ids: códigos de categoria da API de afiliados da Shopee BR
-- (nível 1 ou 2), conferidos em 28/09/2026 pelos produtos que cada código traz.
-- ml_category_ids: categorias raiz do Mercado Livre (MLB…), usadas pelo Piloto.
create table if not exists public.niches (
  id text primary key,
  label text not null,
  sort integer not null default 100,
  featured boolean not null default false,
  active boolean not null default true,
  shopee_category_ids bigint[] not null default '{}',
  ml_category_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.niches enable row level security;
drop policy if exists niches_read on public.niches;
create policy niches_read on public.niches for select to authenticated using (active);

insert into public.niches (id, label, sort, featured, shopee_category_ids) values
  ('moda-feminina',        'Moda Feminina',            10, true,  '{100017}'),
  ('moda-masculina',       'Moda Masculina',           20, true,  '{100011}'),
  ('beleza',               'Beleza',                   30, true,  '{100630}'),
  ('casa',                 'Casa e Decoração',         40, true,  '{100636}'),
  ('cozinha',              'Cozinha',                  50, true,  '{100717}'),
  ('celulares',            'Celulares e Acessórios',   60, true,  '{100013}'),
  ('eletronicos',          'Eletrônicos',              70, true,  '{100013,100535,100644,100634,100635}'),
  ('saude',                'Saúde e Bem-estar',        80, true,  '{100001}'),
  ('pet',                  'Pet Shop',                 90, true,  '{100631}'),
  ('esportes',             'Esportes',                100, true,  '{100637}'),
  ('moda-infantil',        'Moda Infantil',           110, false, '{100633}'),
  ('bebe',                 'Bebê e Maternidade',      120, false, '{100632}'),
  ('brinquedos',           'Brinquedos',              130, false, '{100684}'),
  ('maquiagem',            'Maquiagem',               140, false, '{100662}'),
  ('skincare',             'Skincare',                150, false, '{100664}'),
  ('cabelos',              'Cabelos',                 160, false, '{100659}'),
  ('perfumes',             'Perfumes',                170, false, '{100661}'),
  ('barba',                'Barba e Cuidados Masculinos', 180, false, '{100660}'),
  ('decoracao',            'Decoração',               190, false, '{100711}'),
  ('organizacao',          'Organização',             200, false, '{100721}'),
  ('utilidades',           'Utilidades Domésticas',   210, false, '{100716,100718}'),
  ('iluminacao',           'Iluminação',              220, false, '{100719}'),
  ('moveis',               'Móveis',                  230, false, '{100713}'),
  ('ferramentas',          'Ferramentas e Construção',240, false, '{100715}'),
  ('jardim',               'Jardim',                  250, false, '{100714}'),
  ('eletrodomesticos',     'Eletrodomésticos',        260, false, '{100010}'),
  ('audio',                'Áudio',                   270, false, '{100535}'),
  ('informatica',          'Informática',             280, false, '{100644}'),
  ('games',                'Games',                   290, false, '{100634}'),
  ('cameras',              'Câmeras e Fotografia',    300, false, '{100635}'),
  ('automotivo',           'Automotivo',              310, false, '{100640,102187}'),
  ('motos',                'Motos',                   320, false, '{100641}'),
  ('fitness',              'Fitness',                 330, false, '{100725}'),
  ('bolsas',               'Bolsas e Carteiras',      340, false, '{100016,100533}'),
  ('calcados',             'Calçados',                350, false, '{100532,100012}'),
  ('relogios',             'Relógios',                360, false, '{100534}'),
  ('acessorios',           'Acessórios de Moda',      370, false, '{100009}'),
  ('joias',                'Joias e Bijuterias',      380, false, '{100029}'),
  ('mercado',              'Mercado, Alimentos e Bebidas', 390, false, '{100629}'),
  ('papelaria',            'Papelaria e Festas',      400, false, '{100638}'),
  ('livros',               'Livros',                  410, false, '{100643}'),
  ('hobbies',              'Hobbies e Coleções',      420, false, '{100639}'),
  ('viagem',               'Malas e Viagem',          430, false, '{100015}')
on conflict (id) do update set label = excluded.label, sort = excluded.sort, featured = excluded.featured, shopee_category_ids = excluded.shopee_category_ids, updated_at = now();

-- Ofertas do Catálogo já usadas pela conta (agendadas ou enviadas) desde p_since.
-- Removida da Agenda = envio cancelado = volta a aparecer. O bloqueio é do
-- anúncio (marketplace + código do anúncio), não do produto: o mesmo produto de
-- outro vendedor tem outro código e continua aparecendo.
create or replace function public.catalog_used_offer_keys(p_account_id uuid, p_since timestamptz)
returns table (provider text, external_item_id text)
language sql stable security definer set search_path = public as $$
  select distinct d.provider, d.external_item_id
  from public.affiliate_offer_deliveries d
  left join public.envios_grupo e on e.id = d.group_dispatch_id
  where d.account_id = p_account_id
    and d.created_at >= p_since
    and (e.id is null or e.status <> 'cancelado');
$$;
revoke all on function public.catalog_used_offer_keys(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.catalog_used_offer_keys(uuid, timestamptz) to service_role;
