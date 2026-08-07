-- Bulk schedule batches: group multiple individual lotes created in one operation.
-- Each lote still lives in envios_grupo_lotes; bulk_schedule_id links them together
-- so the user can pause/cancel/track the whole set at once.

create table public.bulk_schedules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  nome text not null,
  campanha_id uuid references public.campanhas(id) on delete set null,
  status text not null default 'programado'
    check (status in ('programado', 'em_andamento', 'concluido', 'pausado', 'cancelado')),
  total int not null default 0,
  agendados int not null default 0,
  enviados int not null default 0,
  erros int not null default 0,
  primeiro_envio_at timestamptz,
  proximo_envio_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bulk_schedules enable row level security;

create index bulk_schedules_account_idx on public.bulk_schedules(account_id, created_at desc);

-- Link individual lotes to a bulk schedule
alter table public.envios_grupo_lotes
  add column if not exists bulk_schedule_id uuid references public.bulk_schedules(id) on delete set null;

create index if not exists envios_grupo_lotes_bulk_idx
  on public.envios_grupo_lotes(bulk_schedule_id)
  where bulk_schedule_id is not null;
