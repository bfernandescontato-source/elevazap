begin;

-- The counter is kept on the automation row so admitting two offers at the
-- same time cannot put both of them in the last available queue position.
alter table public.offer_automations
  add column if not exists active_queue_count integer not null default 0
  check (active_queue_count >= 0);

update public.offer_automations automation
   set active_queue_count = (
     select count(*)::integer
       from public.captured_offers offer
      where offer.automation_id = automation.id
        and offer.status in ('captured', 'processing', 'ready', 'scheduled', 'sending')
   );

create or replace function public.manage_offer_queue_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  admitted boolean;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('captured', 'processing', 'ready', 'scheduled', 'sending') then
      return new;
    end if;

    update public.offer_automations
       set active_queue_count = active_queue_count + 1,
           updated_at = now()
     where id = new.automation_id
       and account_id = new.account_id
       and enabled = true
       and active_queue_count < 5
    returning true into admitted;

    if coalesce(admitted, false) then return new; end if;

    if exists (
      select 1 from public.offer_automations
       where id = new.automation_id and account_id = new.account_id and enabled = true
    ) then
      new.status := 'ignored';
      new.error_code := 'PILOT_QUEUE_FULL';
      new.error_message := 'Não entrou porque a fila estava cheia.';
    else
      new.status := 'ignored';
      new.error_code := 'PILOT_DISABLED';
      new.error_message := 'Piloto Automático desativado.';
    end if;
    new.processed_at := coalesce(new.processed_at, now());
    return new;
  end if;

  if old.status in ('captured', 'processing', 'ready', 'scheduled', 'sending')
     and new.status not in ('captured', 'processing', 'ready', 'scheduled', 'sending') then
    update public.offer_automations
       set active_queue_count = greatest(active_queue_count - 1, 0),
           updated_at = now()
     where id = old.automation_id and account_id = old.account_id;
  elsif old.status not in ('captured', 'processing', 'ready', 'scheduled', 'sending')
     and new.status in ('captured', 'processing', 'ready', 'scheduled', 'sending') then
    update public.offer_automations
       set active_queue_count = active_queue_count + 1,
           updated_at = now()
     where id = new.automation_id
       and account_id = new.account_id
       and enabled = true
       and active_queue_count < 5
    returning true into admitted;
    if not coalesce(admitted, false) then
      raise exception 'A fila está cheia.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists manage_offer_queue_capacity on public.captured_offers;
create trigger manage_offer_queue_capacity
before insert or update of status on public.captured_offers
for each row execute function public.manage_offer_queue_capacity();

create or replace function public.release_deleted_offer_queue_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status in ('captured', 'processing', 'ready', 'scheduled', 'sending') then
    update public.offer_automations
       set active_queue_count = greatest(active_queue_count - 1, 0),
           updated_at = now()
     where id = old.automation_id and account_id = old.account_id;
  end if;
  return old;
end;
$$;

drop trigger if exists release_deleted_offer_queue_capacity on public.captured_offers;
create trigger release_deleted_offer_queue_capacity
after delete on public.captured_offers
for each row execute function public.release_deleted_offer_queue_capacity();

revoke all on function public.manage_offer_queue_capacity() from public, anon, authenticated;
revoke all on function public.release_deleted_offer_queue_capacity() from public, anon, authenticated;

create table if not exists public.offer_automation_config_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  automation_id uuid not null references public.offer_automations(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  source_groups_added jsonb not null default '[]'::jsonb,
  source_groups_removed jsonb not null default '[]'::jsonb,
  destination_groups_added jsonb not null default '[]'::jsonb,
  destination_groups_removed jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists offer_automation_config_events_lookup_idx
  on public.offer_automation_config_events(account_id, automation_id, created_at desc);

alter table public.offer_automation_config_events enable row level security;
drop policy if exists tenant_isolation on public.offer_automation_config_events;
create policy tenant_isolation on public.offer_automation_config_events for all to authenticated
  using (account_id = public.current_account_id() and public.current_account_is_active())
  with check (account_id = public.current_account_id() and public.current_account_is_active());

-- Saves the complete configuration in one database transaction. Group changes
-- affect new offers only; existing dispatches are intentionally untouched.
create or replace function public.save_offer_autopilot_configuration(
  p_account_id uuid,
  p_input jsonb
)
returns public.offer_automations
language plpgsql
set search_path = pg_catalog, public, auth
as $$
declare
  automation public.offer_automations;
  source_ids text[];
  destination_ids text[];
  requested_ids text[];
  previous_source_ids text[];
  previous_destination_ids text[];
  sender_id uuid;
begin
  sender_id := (p_input->>'whatsapp_sender_id')::uuid;

  select coalesce(array_agg(distinct value), '{}'::text[])
    into source_ids
    from jsonb_array_elements_text(coalesce(p_input->'source_group_ids', '[]'::jsonb));
  select coalesce(array_agg(distinct value), '{}'::text[])
    into destination_ids
    from jsonb_array_elements_text(coalesce(p_input->'destination_group_ids', '[]'::jsonb));
  requested_ids := source_ids || destination_ids;

  if not exists (
    select 1 from public.whatsapp_senders
     where id = sender_id and account_id = p_account_id
  ) then raise exception 'Número responsável não pertence à sua conta.'; end if;

  if coalesce((p_input->>'enabled')::boolean, false) and cardinality(source_ids) = 0 then
    raise exception 'Escolha ao menos um grupo fonte.';
  end if;
  if cardinality(source_ids) > 2 then raise exception 'Máximo de 2 grupos fonte por automação.'; end if;
  if coalesce((p_input->>'enabled')::boolean, false) and cardinality(destination_ids) = 0 then
    raise exception 'Escolha ao menos um grupo de destino.';
  end if;
  if exists (
    select 1 from unnest(requested_ids) requested(group_id)
     where group_id not like '%@g.us'
        or not exists (
          select 1 from public.whatsapp_sender_grupos sender_group
           where sender_group.account_id = p_account_id
             and sender_group.whatsapp_sender_id = sender_id
             and sender_group.group_jid = requested.group_id
        )
  ) then raise exception 'Um ou mais grupos não são acessíveis pelo número selecionado.'; end if;

  insert into public.offer_automations (
    account_id, created_by, whatsapp_sender_id, enabled, interval_minutes,
    operating_start, operating_end, timezone, keep_original_text,
    keep_original_media, avoid_duplicates, ai_rewrite_enabled,
    shopee_conversion_enabled, mercado_livre_conversion_enabled,
    conversion_failure_policy, updated_at
  ) values (
    p_account_id, auth.uid(), sender_id, (p_input->>'enabled')::boolean,
    (p_input->>'interval_minutes')::integer, (p_input->>'operating_start')::time,
    (p_input->>'operating_end')::time, p_input->>'timezone',
    (p_input->>'keep_original_text')::boolean, (p_input->>'keep_original_media')::boolean,
    (p_input->>'avoid_duplicates')::boolean, (p_input->>'ai_rewrite_enabled')::boolean,
    (p_input->>'shopee_conversion_enabled')::boolean,
    (p_input->>'mercado_livre_conversion_enabled')::boolean,
    p_input->>'conversion_failure_policy', now()
  )
  on conflict (account_id) do update set
    whatsapp_sender_id = excluded.whatsapp_sender_id,
    enabled = excluded.enabled,
    interval_minutes = excluded.interval_minutes,
    operating_start = excluded.operating_start,
    operating_end = excluded.operating_end,
    timezone = excluded.timezone,
    keep_original_text = excluded.keep_original_text,
    keep_original_media = excluded.keep_original_media,
    avoid_duplicates = excluded.avoid_duplicates,
    ai_rewrite_enabled = excluded.ai_rewrite_enabled,
    shopee_conversion_enabled = excluded.shopee_conversion_enabled,
    mercado_livre_conversion_enabled = excluded.mercado_livre_conversion_enabled,
    conversion_failure_policy = excluded.conversion_failure_policy,
    updated_at = now()
  returning * into automation;

  select coalesce(array_agg(whatsapp_group_id), '{}'::text[])
    into previous_source_ids
    from public.automation_source_groups
   where account_id = p_account_id and automation_id = automation.id and enabled = true;
  select coalesce(array_agg(whatsapp_group_id), '{}'::text[])
    into previous_destination_ids
    from public.automation_destinations
   where account_id = p_account_id and automation_id = automation.id and enabled = true;

  delete from public.automation_source_groups
   where account_id = p_account_id and automation_id = automation.id
     and not (whatsapp_group_id = any(source_ids));
  insert into public.automation_source_groups (
    account_id, automation_id, whatsapp_group_id, priority, enabled, updated_at
  )
  select p_account_id, automation.id, group_id, ordinal - 1, true, now()
    from unnest(source_ids) with ordinality selected(group_id, ordinal)
  on conflict (automation_id, whatsapp_group_id) do update
    set enabled = true, priority = excluded.priority, updated_at = now();

  delete from public.automation_destinations
   where account_id = p_account_id and automation_id = automation.id
     and not (whatsapp_group_id = any(destination_ids));
  insert into public.automation_destinations (
    account_id, automation_id, whatsapp_group_id, enabled
  )
  select p_account_id, automation.id, group_id, true
    from unnest(destination_ids) selected(group_id)
  on conflict (automation_id, whatsapp_group_id) do update set enabled = true;

  insert into public.offer_automation_config_events (
    account_id, automation_id, changed_by,
    source_groups_added, source_groups_removed,
    destination_groups_added, destination_groups_removed
  ) values (
    p_account_id, automation.id, auth.uid(),
    to_jsonb(array(select unnest(source_ids) except select unnest(previous_source_ids))),
    to_jsonb(array(select unnest(previous_source_ids) except select unnest(source_ids))),
    to_jsonb(array(select unnest(destination_ids) except select unnest(previous_destination_ids))),
    to_jsonb(array(select unnest(previous_destination_ids) except select unnest(destination_ids)))
  );

  return automation;
end;
$$;

revoke all on function public.save_offer_autopilot_configuration(uuid, jsonb) from public, anon;
grant execute on function public.save_offer_autopilot_configuration(uuid, jsonb) to authenticated, service_role;

commit;
