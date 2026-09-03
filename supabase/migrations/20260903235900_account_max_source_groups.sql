-- Per-account source group limit. Default is 2 (existing behaviour).
alter table public.accounts add column if not exists max_source_groups integer not null default 2;

-- Unlock extra source groups for rosikellyconceicaocruz@gmail.com.
update public.accounts a
set max_source_groups = 5
from public.app_users u
where u.account_id = a.id and u.email = 'rosikellyconceicaocruz@gmail.com';

-- Restore the three source groups that were removed from her automation.
insert into public.automation_source_groups (account_id, automation_id, whatsapp_group_id, enabled, created_at, updated_at)
select
  oa.account_id,
  oa.id,
  g.group_jid,
  true,
  now(),
  now()
from public.offer_automations oa
join public.app_users u on u.account_id = oa.account_id
cross join (values
  ('120363421883839425@g.us'),
  ('120363425762244773@g.us'),
  ('120363045510303187@g.us')
) as g(group_jid)
where u.email = 'rosikellyconceicaocruz@gmail.com'
on conflict (automation_id, whatsapp_group_id) do update set enabled = true, updated_at = now();
