alter table envios_grupo_lotes
add column if not exists mention_all boolean not null default false;

alter table envios_grupo
add column if not exists mention_all boolean not null default false;
