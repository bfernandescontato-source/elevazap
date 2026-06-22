create table if not exists modelo_pastas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists modelos_mensagem (
  id uuid primary key default gen_random_uuid(),
  pasta_id uuid references modelo_pastas(id) on delete set null,
  nome text not null,
  tipo text check (tipo in ('texto','imagem','video','audio','documento')) not null default 'texto',
  texto text,
  media_bucket text,
  media_path text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists modelo_pastas_nome_idx on modelo_pastas(nome);
create index if not exists modelos_mensagem_pasta_id_idx on modelos_mensagem(pasta_id);
create index if not exists modelos_mensagem_nome_idx on modelos_mensagem(nome);

alter table modelo_pastas enable row level security;
alter table modelos_mensagem enable row level security;
