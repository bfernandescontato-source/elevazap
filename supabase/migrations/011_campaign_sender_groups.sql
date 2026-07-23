alter table if exists campanhas
  add column if not exists whatsapp_sender_id uuid references whatsapp_senders(id) on delete set null;

alter table if exists envios_grupo_lotes
  add column if not exists campanha_id uuid references campanhas(id) on delete set null;

create table if not exists whatsapp_sender_grupos (
  whatsapp_sender_id uuid not null references whatsapp_senders(id) on delete cascade,
  group_jid text not null references grupos(group_jid) on delete cascade,
  updated_at timestamptz default now(),
  primary key (whatsapp_sender_id, group_jid)
);

create index if not exists campanhas_whatsapp_sender_idx on campanhas(whatsapp_sender_id);
create index if not exists envios_grupo_lotes_campanha_idx on envios_grupo_lotes(campanha_id);
create index if not exists whatsapp_sender_grupos_group_idx on whatsapp_sender_grupos(group_jid);

alter table whatsapp_sender_grupos enable row level security;
