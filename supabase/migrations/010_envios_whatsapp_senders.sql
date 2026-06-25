alter table if exists envios
  add column if not exists whatsapp_sender_id uuid references whatsapp_senders(id) on delete set null,
  add column if not exists whatsapp_session_name text;

create index if not exists envios_sender_idx on envios(whatsapp_sender_id);
create index if not exists envios_session_name_idx on envios(whatsapp_session_name);
