begin;

alter table public.captured_offers
  add column if not exists ai_rewrite_status text not null default 'not_enabled'
    check (ai_rewrite_status in ('not_enabled','pending','rewritten','fallback')),
  add column if not exists ai_rewrite_attempts integer not null default 0,
  add column if not exists ai_rewrite_model text,
  add column if not exists ai_rewrite_error text,
  add column if not exists ai_rewritten_at timestamptz;

create index if not exists captured_offers_ai_rewrite_idx
  on public.captured_offers(account_id, ai_rewrite_status, captured_at desc);

notify pgrst, 'reload schema';

commit;
