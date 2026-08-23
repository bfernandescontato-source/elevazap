-- Mantém o ritmo escolhido no próprio disparo. Assim, mensagens urgentes não
-- dependem de uma variável global nem alteram um lote que já está em andamento.
alter table public.official_broadcasts
  add column if not exists delivery_speed text not null default 'standard'
  check (delivery_speed in ('standard', 'urgent')),
  add column if not exists dispatch_concurrency integer;

alter table public.official_broadcasts
  drop constraint if exists official_broadcasts_dispatch_concurrency_check;
alter table public.official_broadcasts
  add constraint official_broadcasts_dispatch_concurrency_check
  check (dispatch_concurrency is null or dispatch_concurrency between 1 and 60);
