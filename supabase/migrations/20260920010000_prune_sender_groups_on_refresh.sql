-- "Atualizar grupos" só acrescentava os grupos encontrados em whatsapp_sender_grupos e
-- nunca removia os que o número deixou de ter (saiu, foi removido ou o grupo foi
-- apagado). Numa conta, 38 de 75 grupos da lista estavam parados desde 26/08.
-- Consequências: a tela mostrava grupos que não existem e, pior, destinos do Piloto
-- apontando para eles geravam "forbidden" em série, o que abre o disjuntor do
-- número inteiro e bloqueia todos os envios da conta.
--
-- prune_sender_groups recebe a lista que acabou de ser lida do WhatsApp e remove o
-- que não está nela, tanto da lista do número quanto dos destinos do Piloto desse
-- número. Lista vazia não remove nada (falha de leitura não pode apagar tudo).
-- Grupos de origem não são tocados: a tela avisa, e trocar de origem é decisão do cliente.
create or replace function public.prune_sender_groups(p_account_id uuid, p_sender_id uuid, p_group_jids text[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_removed integer;
begin
  if p_group_jids is null or cardinality(p_group_jids) = 0 then
    return 0;
  end if;

  if not exists (select 1 from public.whatsapp_senders where id = p_sender_id and account_id = p_account_id) then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;

  delete from public.automation_destinations destination
  using public.offer_automations automation
  where destination.automation_id = automation.id
    and automation.account_id = p_account_id
    and automation.whatsapp_sender_id = p_sender_id
    and destination.account_id = p_account_id
    and destination.whatsapp_group_id <> all (p_group_jids);

  delete from public.whatsapp_sender_grupos
  where account_id = p_account_id
    and whatsapp_sender_id = p_sender_id
    and group_jid <> all (p_group_jids);
  get diagnostics v_removed = row_count;

  return v_removed;
end;
$function$;

revoke all on function public.prune_sender_groups(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.prune_sender_groups(uuid, uuid, text[]) to service_role;
