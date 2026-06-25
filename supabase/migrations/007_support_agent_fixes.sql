alter table if exists support_conversation
  add column if not exists updated_at timestamptz default now();

create index if not exists support_conversation_updated_at_idx
  on support_conversation(updated_at desc);
