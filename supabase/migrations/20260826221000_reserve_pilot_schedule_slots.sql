begin;

alter table public.offer_automations
  add column if not exists pilot_next_slot_at timestamptz;

create or replace function public.reserve_offer_schedule_slot(
  p_automation_id uuid,
  p_now timestamptz default now()
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  automation public.offer_automations;
  base_at timestamptz;
  local_base timestamp;
  scheduled_local timestamp;
  scheduled_at timestamptz;
begin
  select * into automation
    from public.offer_automations
   where id = p_automation_id
   for update;
  if not found then raise exception 'Automação não encontrada.' using errcode = 'P0002'; end if;

  base_at := greatest(p_now, coalesce(automation.pilot_next_slot_at, p_now));
  local_base := base_at at time zone automation.timezone;

  if local_base::time < automation.operating_start then
    scheduled_local := local_base::date + automation.operating_start;
  elsif local_base::time > automation.operating_end then
    scheduled_local := (local_base::date + 1) + automation.operating_start;
  else
    scheduled_local := local_base;
  end if;

  scheduled_at := scheduled_local at time zone automation.timezone;
  update public.offer_automations
     set pilot_next_slot_at = scheduled_at + make_interval(mins => automation.interval_minutes),
         updated_at = now()
   where id = automation.id;
  return scheduled_at;
end;
$$;

revoke all on function public.reserve_offer_schedule_slot(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_offer_schedule_slot(uuid, timestamptz) to service_role;

commit;
