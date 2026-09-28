-- Nova identidade visual (tema "terra") liberada para todas as contas e padrão
-- para as novas. Aplicada em produção em 28/09/2026.
alter table public.accounts alter column ui_theme set default 'terra';
update public.accounts set ui_theme = 'terra' where ui_theme <> 'terra';
