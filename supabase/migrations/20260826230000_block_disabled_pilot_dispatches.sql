begin;

-- This is the final dispatch gate. It runs inside Postgres for every group job,
-- independently of the web UI or worker timing.
create or replace function public.block_disabled_pilot_dispatch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status not in ('enfileirado', 'processando') then return new; end if;

  if exists (
    select 1
      from public.offer_deliveries delivery
      join public.captured_offers offer on offer.id = delivery.offer_id
      join public.offer_automations automation on automation.id = offer.automation_id
     where delivery.group_dispatch_id = new.id
       and delivery.account_id = new.account_id
       and automation.account_id = new.account_id
       and automation.enabled is false
  ) then
    new.status := 'cancelado';
    new.claim_token := null;
    new.processing_deadline_at := null;
    new.erro := 'Piloto Automático desativado.';
    new.updated_at := now();

    update public.offer_deliveries
       set status = 'cancelled', error_message = 'Piloto Automático desativado.', updated_at = now()
     where group_dispatch_id = new.id
       and account_id = new.account_id
       and status in ('pending', 'scheduled', 'sending');
  end if;
  return new;
end;
$$;

drop trigger if exists block_disabled_pilot_dispatch_before_send on public.envios_grupo;
create trigger block_disabled_pilot_dispatch_before_send
before update of status on public.envios_grupo
for each row
execute function public.block_disabled_pilot_dispatch();

revoke all on function public.block_disabled_pilot_dispatch() from public, anon, authenticated;
grant execute on function public.block_disabled_pilot_dispatch() to service_role;

commit;
