begin;

-- The legacy trigger tries to cancel a whole historical backlog during the
-- settings save, which can make the toggle fail. Dispatch blocking is now
-- handled by block_disabled_pilot_dispatch at the queue boundary.
drop trigger if exists stop_offer_automation_on_disable on public.offer_automations;

commit;
