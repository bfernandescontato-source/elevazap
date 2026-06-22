create table if not exists campanhas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists campanha_grupos (
  campanha_id uuid not null references campanhas(id) on delete cascade,
  group_jid text not null references grupos(group_jid) on delete cascade,
  created_at timestamptz default now(),
  primary key(campanha_id, group_jid)
);

create index if not exists campanhas_nome_idx on campanhas(nome);
create index if not exists campanha_grupos_group_jid_idx on campanha_grupos(group_jid);

alter table campanhas enable row level security;
alter table campanha_grupos enable row level security;
