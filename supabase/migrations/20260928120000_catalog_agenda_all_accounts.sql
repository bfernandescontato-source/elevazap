-- Agenda do Catálogo liberada para todas as contas (aplicada em produção em 28/09/2026).
-- Contas novas já nascem com a Agenda ligada.
alter table public.accounts alter column catalog_agenda_enabled set default true;
update public.accounts set catalog_agenda_enabled = true where catalog_agenda_enabled is distinct from true;
