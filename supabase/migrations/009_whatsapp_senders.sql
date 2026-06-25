create extension if not exists pgcrypto;

create table if not exists whatsapp_senders (
  id uuid primary key default gen_random_uuid(),
  session_name text unique not null,
  label text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists envios_grupo_lotes
  add column if not exists whatsapp_sender_id uuid references whatsapp_senders(id) on delete set null,
  add column if not exists whatsapp_session_name text;

alter table if exists envios_grupo
  add column if not exists whatsapp_sender_id uuid references whatsapp_senders(id) on delete set null,
  add column if not exists whatsapp_session_name text;

create index if not exists whatsapp_senders_session_name_idx on whatsapp_senders(session_name);
create index if not exists envios_grupo_sender_idx on envios_grupo(whatsapp_sender_id);
create index if not exists envios_grupo_lotes_sender_idx on envios_grupo_lotes(whatsapp_sender_id);

alter table whatsapp_senders enable row level security;
