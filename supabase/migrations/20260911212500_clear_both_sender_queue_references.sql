begin;

-- Queue rows temporarily keep the legacy sender column and the canonical
-- session column in sync. When a sender is deleted, either FK may be cleared
-- first by PostgreSQL; do not let the trigger restore the deleted reference
-- from the other column.
create or replace function public.sync_whatsapp_session_id() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE'
     and old.whatsapp_session_id is not null
     and old.whatsapp_sender_id is not null
     and (
       (new.whatsapp_session_id is null and new.whatsapp_sender_id = old.whatsapp_sender_id)
       or
       (new.whatsapp_sender_id is null and new.whatsapp_session_id = old.whatsapp_session_id)
     ) then
    new.whatsapp_session_id := null;
    new.whatsapp_sender_id := null;
    return new;
  end if;

  if new.whatsapp_session_id is null then new.whatsapp_session_id := new.whatsapp_sender_id; end if;
  if new.whatsapp_sender_id is null then new.whatsapp_sender_id := new.whatsapp_session_id; end if;
  if new.whatsapp_session_id is distinct from new.whatsapp_sender_id then
    raise exception 'whatsapp_session_id e whatsapp_sender_id divergentes' using errcode = '23514';
  end if;
  return new;
end $$;

commit;
