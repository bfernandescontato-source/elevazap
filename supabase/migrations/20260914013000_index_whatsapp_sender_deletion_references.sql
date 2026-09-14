begin;

-- PostgreSQL checks every referencing foreign key when a connected number is
-- removed. Some newer references did not have a lookup index, causing a full
-- table scan and a statement timeout for accounts with message history.
create index if not exists envios_whatsapp_session_id_idx
  on public.envios(whatsapp_session_id)
  where whatsapp_session_id is not null;

create index if not exists envios_grupo_whatsapp_session_id_idx
  on public.envios_grupo(whatsapp_session_id)
  where whatsapp_session_id is not null;

create index if not exists envios_grupo_lotes_whatsapp_session_id_idx
  on public.envios_grupo_lotes(whatsapp_session_id)
  where whatsapp_session_id is not null;

create index if not exists offer_automations_whatsapp_sender_id_idx
  on public.offer_automations(whatsapp_sender_id)
  where whatsapp_sender_id is not null;

create index if not exists group_participant_syncs_whatsapp_sender_id_idx
  on public.group_participant_syncs(whatsapp_sender_id)
  where whatsapp_sender_id is not null;

create index if not exists official_group_membership_events_sender_id_idx
  on public.official_group_membership_events(sender_id)
  where sender_id is not null;

create index if not exists affiliate_offer_deliveries_sender_id_idx
  on public.affiliate_offer_deliveries(sender_id)
  where sender_id is not null;

create index if not exists whatsapp_auth_keys_account_session_idx
  on public.whatsapp_auth_keys(account_id, session_name);

create index if not exists whatsapp_auth_creds_account_session_idx
  on public.whatsapp_auth_creds(account_id, session_name);

commit;
