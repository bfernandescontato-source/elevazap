begin;

alter table public.app_users
  add column if not exists avatar_path text;

comment on column public.app_users.avatar_path is
  'Caminho privado da foto de perfil no bucket community-media.';

notify pgrst, 'reload schema';
commit;
