begin;

create or replace function public.recompact_pilot_after_schedule_config_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.enabled then
    perform public.compact_pilot_schedule_locked(new.id, now());
  end if;
  return new;
end;
$$;

revoke all on function public.recompact_pilot_after_schedule_config_change()
  from public, anon, authenticated, service_role;

drop trigger if exists recompact_pilot_after_schedule_config_change
  on public.offer_automations;
create trigger recompact_pilot_after_schedule_config_change
after update of interval_minutes, operating_start, operating_end, timezone
on public.offer_automations
for each row
when (
  old.interval_minutes is distinct from new.interval_minutes
  or old.operating_start is distinct from new.operating_start
  or old.operating_end is distinct from new.operating_end
  or old.timezone is distinct from new.timezone
)
execute function public.recompact_pilot_after_schedule_config_change();

commit;
