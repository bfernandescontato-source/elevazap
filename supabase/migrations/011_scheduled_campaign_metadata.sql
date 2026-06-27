alter table if exists envios_grupo_lotes
  add column if not exists campanha_id uuid references campanhas(id) on delete set null,
  add column if not exists campanha_nome text;

alter table if exists envios_grupo
  add column if not exists campanha_id uuid references campanhas(id) on delete set null,
  add column if not exists campanha_nome text;

create index if not exists envios_grupo_lotes_campanha_idx on envios_grupo_lotes(campanha_id);
create index if not exists envios_grupo_campanha_idx on envios_grupo(campanha_id);
