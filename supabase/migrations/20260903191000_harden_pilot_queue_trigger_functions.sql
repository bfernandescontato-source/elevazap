begin;

-- Trigger functions are internal implementation details and must not be
-- callable through the exposed Data API.
revoke all on function public.manage_offer_queue_capacity() from public, anon, authenticated;
revoke all on function public.release_deleted_offer_queue_capacity() from public, anon, authenticated;

commit;
