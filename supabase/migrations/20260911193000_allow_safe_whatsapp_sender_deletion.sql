begin;

-- A sender can be replaced without deleting the automation and its delivery
-- history. The API disables the automation before deleting the sender; this
-- relationship then becomes empty until another sender is selected.
alter table public.offer_automations
  alter column whatsapp_sender_id drop not null;

alter table public.offer_automations
  drop constraint if exists offer_automations_whatsapp_sender_id_fkey;

alter table public.offer_automations
  add constraint offer_automations_whatsapp_sender_id_fkey
  foreign key (whatsapp_sender_id)
  references public.whatsapp_senders(id)
  on delete set null;

commit;
