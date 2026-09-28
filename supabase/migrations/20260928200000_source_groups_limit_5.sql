-- Limite de grupos fonte do Piloto: 5 para todas as contas (todos os planos),
-- inclusive as novas. Aplicada em produção em 28/09/2026.
alter table public.accounts alter column max_source_groups set default 5;
update public.accounts set max_source_groups = 5 where max_source_groups < 5;
