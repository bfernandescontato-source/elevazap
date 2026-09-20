-- Excluir um número (delete_whatsapp_sender) estourava o tempo limite em contas
-- com histórico grande. A função reescrevia, em lotes de 5.000, todas as linhas
-- de histórico que apontavam para o número (uma conta tinha 147 mil em
-- envios_grupo, 14 mil em lotes e 53 mil em group_participant_syncs): ~0,4 ms
-- por linha (o banco atualiza 13 índices por linha), ou seja, mais de um minuto
-- e crescendo todo dia, sem nunca caber no limite da conexão do painel (8 s).
--
-- 1) Histórico e logs NÃO devem ter chave estrangeira rígida para uma entidade
--    que pode ser excluída. Removemos as chaves estrangeiras dessas tabelas; o
--    histórico mantém o identificador antigo do número e a exclusão deixa de
--    depender do tamanho do histórico. Mantemos as usadas pelo código para
--    embutir dados (campanhas, offer_automations) e as de CASCADE
--    (whatsapp_sender_grupos, whatsapp_session_leases).
-- 2) O que sobra é trabalho proporcional ao que está ativo (cancelar pendentes)
--    e varia com o cache do banco (1,9 s a quente, ~8 s a frio na conta maior).
--    Por isso a exclusão é dividida em três chamadas independentes, cada uma com
--    o seu próprio limite de tempo; delete_whatsapp_sender continua funcionando
--    sozinha (repete os cancelamentos, que são idempotentes).
-- 3) As chaves de criptografia da sessão chegam a 20 mil linhas (~0,26 ms cada):
--    a exclusão apaga 3.000 e o resto, que ninguém mais usa, sai em lotes por
--    purge_orphan_whatsapp_auth_keys.
-- 4) As funções são SECURITY DEFINER e confiam em p_account_id, mas
--    delete_whatsapp_sender estava executável por anon/authenticated (revoke
--    ... from public não remove concessões diretas). Passam a ser só do
--    service_role, que é quem as chama.
set local lock_timeout = '5s';

alter table public.envios
  drop constraint if exists envios_whatsapp_session_id_fkey,
  drop constraint if exists envios_whatsapp_sender_id_fkey;
alter table public.envios_grupo
  drop constraint if exists envios_grupo_whatsapp_sender_id_fkey,
  drop constraint if exists envios_grupo_whatsapp_session_id_fkey;
alter table public.envios_grupo_lotes
  drop constraint if exists envios_grupo_lotes_whatsapp_session_id_fkey,
  drop constraint if exists envios_grupo_lotes_whatsapp_sender_id_fkey;
alter table public.group_participant_syncs
  drop constraint if exists group_participant_syncs_whatsapp_sender_id_fkey;
alter table public.affiliate_offer_deliveries
  drop constraint if exists affiliate_offer_deliveries_sender_id_fkey;
alter table public.official_group_membership_events
  drop constraint if exists official_group_membership_events_sender_id_fkey;
alter table public.campaign_participant_events
  drop constraint if exists campaign_participant_events_whatsapp_sender_id_fkey;

create or replace function public.purge_orphan_whatsapp_auth_keys(p_limit integer default 4000)
 returns integer
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_rows integer;
begin
  delete from public.whatsapp_auth_keys
  where ctid in (
    select k.ctid from public.whatsapp_auth_keys k
    where not exists (
      select 1 from public.whatsapp_senders s
      where s.session_name = k.session_name and s.account_id = k.account_id
    )
    limit greatest(p_limit, 1)
  );
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

create or replace function public.cancel_whatsapp_sender_pending_work(p_account_id uuid, p_sender_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_now timestamptz := now();
  v_cancellation text := 'Envio cancelado porque o número responsável foi excluído.';
begin
  if not exists (select 1 from public.whatsapp_senders where id = p_sender_id and account_id = p_account_id) then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;

  update public.offer_automations
  set enabled = false, pilot_next_slot_at = null, updated_at = v_now
  where account_id = p_account_id and whatsapp_sender_id = p_sender_id
    and (enabled or pilot_next_slot_at is not null);

  update public.envios
  set status = 'erro', erro = v_cancellation, resolution_note = v_cancellation,
      resolved_at = v_now, claim_token = null, updated_at = v_now
  where account_id = p_account_id
    and (whatsapp_sender_id = p_sender_id or whatsapp_session_id = p_sender_id)
    and status in ('pendente', 'enfileirado', 'processando', 'pausado', 'incerto');

  update public.envios_grupo
  set status = 'erro', erro = v_cancellation, resolution_note = v_cancellation,
      resolved_at = v_now, claim_token = null, updated_at = v_now
  where account_id = p_account_id
    and (whatsapp_sender_id = p_sender_id or whatsapp_session_id = p_sender_id)
    and status in ('pendente', 'enfileirado', 'processando', 'pausado', 'incerto');
end;
$function$;

create or replace function public.cancel_whatsapp_sender_pending_batches(p_account_id uuid, p_sender_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_now timestamptz := now();
begin
  if not exists (select 1 from public.whatsapp_senders where id = p_sender_id and account_id = p_account_id) then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;

  update public.envios_grupo_lotes
  set status = 'cancelado', finished_at = v_now, updated_at = v_now
  where account_id = p_account_id
    and (whatsapp_sender_id = p_sender_id or whatsapp_session_id = p_sender_id)
    and status in ('pendente', 'enfileirado', 'processando', 'pausado', 'incerto');
end;
$function$;

create or replace function public.delete_whatsapp_sender(p_account_id uuid, p_sender_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_session_name text;
  v_now timestamptz := now();
begin
  select session_name into v_session_name
  from public.whatsapp_senders
  where id = p_sender_id and account_id = p_account_id
  for update;

  if v_session_name is null then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;

  -- Idempotentes: quando o painel já chamou as duas etapas, não sobra nada a cancelar.
  perform public.cancel_whatsapp_sender_pending_work(p_account_id, p_sender_id);
  perform public.cancel_whatsapp_sender_pending_batches(p_account_id, p_sender_id);

  -- O histórico (envios, lotes, sincronizações, eventos) mantém o identificador
  -- antigo do número: reescrever milhares de linhas é o que estourava o tempo.
  update public.campanhas set whatsapp_sender_id = null, updated_at = v_now
  where account_id = p_account_id and whatsapp_sender_id = p_sender_id;

  delete from public.whatsapp_sender_grupos
  where account_id = p_account_id and whatsapp_sender_id = p_sender_id;

  delete from public.whatsapp_auth_keys
  where ctid in (
    select ctid from public.whatsapp_auth_keys
    where account_id = p_account_id and session_name = v_session_name
    limit 3000
  );
  delete from public.whatsapp_auth_creds
  where account_id = p_account_id and session_name = v_session_name;
  delete from public.whatsapp_senders
  where id = p_sender_id and account_id = p_account_id;
end;
$function$;

revoke all on function public.delete_whatsapp_sender(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_whatsapp_sender(uuid, uuid) to service_role;
revoke all on function public.cancel_whatsapp_sender_pending_work(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_whatsapp_sender_pending_work(uuid, uuid) to service_role;
revoke all on function public.cancel_whatsapp_sender_pending_batches(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_whatsapp_sender_pending_batches(uuid, uuid) to service_role;
revoke all on function public.purge_orphan_whatsapp_auth_keys(integer) from public, anon, authenticated;
grant execute on function public.purge_orphan_whatsapp_auth_keys(integer) to service_role;

notify pgrst, 'reload schema';
