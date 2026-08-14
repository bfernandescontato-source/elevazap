begin;

alter table public.captured_offers
  add constraint captured_offers_account_id_source_group_id_fkey
  foreign key (account_id, source_group_id)
  references public.grupos(account_id, group_jid)
  on delete restrict;

notify pgrst, 'reload schema';

commit;
