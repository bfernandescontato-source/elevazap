begin;
alter table public.official_automations
  add column if not exists name text,
  add column if not exists followup_mode text not null default 'legacy' check (followup_mode in ('legacy','none','button')),
  add column if not exists followup_config jsonb;
update public.official_automations set name = coalesce(product_name, 'Automação ' || event_type) where name is null;
create unique index if not exists official_automation_active_trigger_unique
  on public.official_automations(event_type, (coalesce(product_id,''))) where active;
alter table public.official_messages
  add column if not exists automation_id uuid references public.official_automations(id) on delete restrict,
  add column if not exists automation_snapshot jsonb,
  add column if not exists automation_reply_state text check (automation_reply_state in ('waiting','sending','sent','failed'));
create index if not exists official_messages_automation_idx on public.official_messages(automation_id,created_at desc);
alter table public.official_flows add column if not exists quick_reply_payload text;
update public.official_flows f set quick_reply_payload = a.payload from public.official_quick_reply_actions a
  where f.quick_reply_action_id = a.id and f.quick_reply_payload is null;

-- The existing purchase template was verified to have "Ver detalhes" at index 0.
-- Copy its response without changing the global action used by already-sent messages.
update public.official_automations a
set followup_mode = 'button',
    followup_config = jsonb_build_object(
      'triggerButtonIndex', '0', 'responseType', q.response_type,
      'responseText', q.response_text, 'caption', q.caption,
      'mediaBucket', q.media_bucket, 'mediaPath', q.media_path,
      'mimeType', q.mime_type, 'fileName', q.file_name, 'buttonConfig', q.button_config
    )
from public.official_quick_reply_actions q
where a.id = 'c9ba5573-6c36-4ab1-a2d9-3baf9c47d6f3'
  and a.template_name = 'access_purchase' and a.template_language = 'pt_BR'
  and a.followup_mode = 'legacy'
  and q.id = '31753a28-11e8-4ca3-af50-86830b6636cd'
  and q.payload = 'Ver detalhes' and q.active and q.response_type = 'text'
  and (q.button_config is null or q.button_config->>'type' = 'url');
commit;
