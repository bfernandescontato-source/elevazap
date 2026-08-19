begin;

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  content text not null check (char_length(content) between 1 and 5000),
  category text not null default 'geral' check (category in ('resultado','oferta','trafego','automacao','duvida','estrategia','aviso','geral')),
  is_official boolean not null default false,
  is_pinned boolean not null default false,
  is_hidden boolean not null default false,
  image_paths text[] not null default '{}',
  result_amount_cents integer check (result_amount_cents is null or result_amount_cents >= 0),
  result_marketplace text check (result_marketplace is null or result_marketplace in ('shopee','mercado_livre','amazon','tiktok_shop','outro')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index community_posts_feed_idx on public.community_posts(is_pinned desc, created_at desc) where deleted_at is null and is_hidden = false;
create index community_posts_category_idx on public.community_posts(category) where deleted_at is null and is_hidden = false;
create index community_posts_account_idx on public.community_posts(account_id);
create index community_posts_user_idx on public.community_posts(user_id) where user_id is not null;

create table public.community_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(post_id, user_id)
);
create index community_likes_post_idx on public.community_likes(post_id);

create table public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  content text not null check (char_length(content) between 1 and 2000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index community_comments_post_idx on public.community_comments(post_id, created_at) where deleted_at is null;
create index community_comments_user_idx on public.community_comments(user_id) where user_id is not null;

create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  reporter_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('spam','conteudo_impropriado','golpe','informacao_enganosa','outro')),
  details text,
  status text not null default 'pending' check (status in ('pending','reviewed','dismissed')),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(post_id, reporter_user_id)
);
create index community_reports_pending_idx on public.community_reports(status, created_at desc) where status = 'pending';

create table public.community_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  type text not null check (type in ('like','comment')),
  post_id uuid references public.community_posts(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index community_notifications_recipient_idx on public.community_notifications(recipient_user_id, read_at, created_at desc);

-- RLS: desvio deliberado do padrão tenant_isolation usado no resto do banco.
-- A Comunidade é global entre contas (leitura liberada), só a escrita é restrita ao dono.
-- community_reports e community_notifications continuam privados por usuário.

alter table public.community_posts enable row level security;
grant select, insert, update, delete on public.community_posts to authenticated, service_role;
create policy community_posts_select_all on public.community_posts for select to authenticated using (true);
create policy community_posts_insert_own on public.community_posts for insert to authenticated
  with check (user_id = auth.uid() and account_id = public.current_account_id() and public.current_account_is_active());
create policy community_posts_update_own on public.community_posts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.community_likes enable row level security;
grant select, insert, update, delete on public.community_likes to authenticated, service_role;
create policy community_likes_select_all on public.community_likes for select to authenticated using (true);
create policy community_likes_insert_own on public.community_likes for insert to authenticated
  with check (user_id = auth.uid() and account_id = public.current_account_id() and public.current_account_is_active());
create policy community_likes_delete_own on public.community_likes for delete to authenticated using (user_id = auth.uid());

alter table public.community_comments enable row level security;
grant select, insert, update, delete on public.community_comments to authenticated, service_role;
create policy community_comments_select_all on public.community_comments for select to authenticated using (true);
create policy community_comments_insert_own on public.community_comments for insert to authenticated
  with check (user_id = auth.uid() and account_id = public.current_account_id() and public.current_account_is_active());
create policy community_comments_update_own on public.community_comments for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.community_reports enable row level security;
grant select, insert, update, delete on public.community_reports to authenticated, service_role;
create policy community_reports_select_own on public.community_reports for select to authenticated using (reporter_user_id = auth.uid());
create policy community_reports_insert_own on public.community_reports for insert to authenticated
  with check (reporter_user_id = auth.uid() and account_id = public.current_account_id() and public.current_account_is_active());

alter table public.community_notifications enable row level security;
grant select, insert, update, delete on public.community_notifications to authenticated, service_role;
create policy community_notifications_select_own on public.community_notifications for select to authenticated using (recipient_user_id = auth.uid());
create policy community_notifications_update_own on public.community_notifications for update to authenticated
  using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('community-media','community-media',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

notify pgrst, 'reload schema';
commit;
