begin;

-- Duplicated content is a valid business message for the Piloto Automático.
-- Keep the column for historical compatibility, but disable the old policy.
alter table public.offer_automations alter column avoid_duplicates set default false;
update public.offer_automations set avoid_duplicates = false where avoid_duplicates is true;

commit;
