-- Permite fluxos que terminam no próprio botão de URL do template inicial.
alter table public.official_flows
  add column if not exists delivery_mode text not null default 'quick_reply'
  check (delivery_mode in ('quick_reply', 'direct_link'));

alter table public.official_flows
  alter column quick_reply_action_id drop not null;

alter table public.official_flows
  add constraint official_flows_delivery_action_check
  check (
    (delivery_mode = 'quick_reply' and quick_reply_action_id is not null)
    or (delivery_mode = 'direct_link' and quick_reply_action_id is null)
  ) not valid;

alter table public.official_flows validate constraint official_flows_delivery_action_check;
