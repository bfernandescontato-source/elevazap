begin;

create table if not exists public.pilot_recovery_control_events (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('execute_revoked', 'execute_restored')),
  function_signature text not null,
  affected_role text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.pilot_recovery_control_events enable row level security;

revoke execute on function public.claim_interrupted_pilot_offers(text, integer, integer)
  from service_role;

insert into public.pilot_recovery_control_events (
  action, function_signature, affected_role, reason
) values (
  'execute_revoked',
  'public.claim_interrupted_pilot_offers(text, integer, integer)',
  'service_role',
  'Contenção do incidente: impedir consumo das ofertas recuperadas acidentalmente em 2026-09-08.'
);

do $$
begin
  if has_function_privilege(
    'service_role',
    'public.claim_interrupted_pilot_offers(text, integer, integer)',
    'EXECUTE'
  ) then
    raise exception 'CONTENÇÃO ABORTADA: service_role ainda pode executar claim_interrupted_pilot_offers.';
  end if;
end;
$$;

commit;
