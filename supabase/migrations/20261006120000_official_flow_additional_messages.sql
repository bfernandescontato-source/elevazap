-- Permite que um fluxo envie mensagens de texto separadas depois da resposta ao clique.
-- O campo fica no fluxo para que edições futuras não alterem execuções já concluídas.
alter table public.official_flows
  add column if not exists additional_messages jsonb not null default '[]'::jsonb;

alter table public.official_flows
  drop constraint if exists official_flows_additional_messages_array_check,
  add constraint official_flows_additional_messages_array_check
  check (jsonb_typeof(additional_messages) = 'array' and jsonb_array_length(additional_messages) <= 10);
