create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  role text not null default 'operator' check (role in ('admin', 'operator')),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_users_status_idx on public.app_users(status, created_at desc);
create index if not exists app_users_role_idx on public.app_users(role);

create or replace function public.handle_new_app_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare first_user boolean;
begin
  perform pg_advisory_xact_lock(812734991);
  select not exists(select 1 from public.app_users) into first_user;
  insert into public.app_users(id, email, name, role, status, approved_at)
  values (
    new.id,
    lower(new.email),
    nullif(trim(coalesce(new.raw_user_meta_data->>'name', '')), ''),
    case when first_user then 'admin' else 'operator' end,
    case when first_user then 'active' else 'pending' end,
    case when first_user then now() else null end
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_app_profile on auth.users;
create trigger on_auth_user_created_app_profile
  after insert or update of email on auth.users
  for each row execute procedure public.handle_new_app_user();

insert into public.app_users(id, email, name, role, status, approved_at)
select id, lower(email), nullif(trim(coalesce(raw_user_meta_data->>'name', '')), ''),
       case when row_number() over (order by created_at, id) = 1 then 'admin' else 'operator' end,
       case when row_number() over (order by created_at, id) = 1 then 'active' else 'pending' end,
       case when row_number() over (order by created_at, id) = 1 then now() else null end
from auth.users
where email is not null
on conflict (id) do nothing;

alter table public.app_users enable row level security;

create or replace function public.current_user_is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.app_users
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

drop policy if exists app_users_read_self_or_admin on public.app_users;
create policy app_users_read_self_or_admin on public.app_users
  for select to authenticated
  using (id = auth.uid() or public.current_user_is_app_admin());

drop policy if exists app_users_admin_update on public.app_users;
create policy app_users_admin_update on public.app_users
  for update to authenticated
  using (public.current_user_is_app_admin())
  with check (public.current_user_is_app_admin());

revoke all on function public.handle_new_app_user() from public;
grant execute on function public.current_user_is_app_admin() to authenticated;
