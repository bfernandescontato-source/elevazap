begin;

-- A sender can have a large delivery history. Do this work in the database so
-- the user gets one atomic action instead of several HTTP updates that can hit
-- the statement timeout halfway through.
create or replace function public.delete_whatsapp_sender(
  p_account_id uuid,
  p_sender_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session_name text;
  v_rows integer;
  v_now timestamptz := now();
  v_cancellation text := 'Envio cancelado porque o número responsável foi excluído.';
begin
  perform set_config('statement_timeout', '120000', true);

  select session_name into v_session_name
  from public.whatsapp_senders
  where id = p_sender_id and account_id = p_account_id
  for update;

  if v_session_name is null then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;

  update public.offer_automations
  set enabled = false, pilot_next_slot_at = null, updated_at = v_now
  where account_id = p_account_id and whatsapp_sender_id = p_sender_id;

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

  update public.envios_grupo_lotes
  set status = 'cancelado', finished_at = v_now, updated_at = v_now
  where account_id = p_account_id
    and (whatsapp_sender_id = p_sender_id or whatsapp_session_id = p_sender_id)
    and status in ('pendente', 'enfileirado', 'processando', 'pausado', 'incerto');

  loop
    with batch as (
      select ctid from public.envios
      where account_id = p_account_id
        and (whatsapp_sender_id = p_sender_id or whatsapp_session_id = p_sender_id)
      limit 5000
    )
    update public.envios set whatsapp_sender_id = null, whatsapp_session_id = null
    where ctid in (select ctid from batch);
    get diagnostics v_rows = row_count;
    exit when v_rows = 0;
  end loop;

  loop
    with batch as (
      select ctid from public.envios_grupo
      where account_id = p_account_id
        and (whatsapp_sender_id = p_sender_id or whatsapp_session_id = p_sender_id)
      limit 5000
    )
    update public.envios_grupo set whatsapp_sender_id = null, whatsapp_session_id = null
    where ctid in (select ctid from batch);
    get diagnostics v_rows = row_count;
    exit when v_rows = 0;
  end loop;

  loop
    with batch as (
      select ctid from public.envios_grupo_lotes
      where account_id = p_account_id
        and (whatsapp_sender_id = p_sender_id or whatsapp_session_id = p_sender_id)
      limit 5000
    )
    update public.envios_grupo_lotes set whatsapp_sender_id = null, whatsapp_session_id = null
    where ctid in (select ctid from batch);
    get diagnostics v_rows = row_count;
    exit when v_rows = 0;
  end loop;

  update public.campanhas set whatsapp_sender_id = null, updated_at = v_now
  where account_id = p_account_id and whatsapp_sender_id = p_sender_id;

  delete from public.whatsapp_sender_grupos
  where account_id = p_account_id and whatsapp_sender_id = p_sender_id;
  delete from public.whatsapp_auth_keys
  where account_id = p_account_id and session_name = v_session_name;
  delete from public.whatsapp_auth_creds
  where account_id = p_account_id and session_name = v_session_name;
  delete from public.whatsapp_senders
  where id = p_sender_id and account_id = p_account_id;
end;
$$;

revoke all on function public.delete_whatsapp_sender(uuid, uuid) from public;
grant execute on function public.delete_whatsapp_sender(uuid, uuid) to service_role;

commit;
