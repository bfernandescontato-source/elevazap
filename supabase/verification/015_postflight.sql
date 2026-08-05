select account_id, count(*) users from public.app_users group by account_id;
select 'envios' table_name, count(*) rows, count(account_id) assigned from public.envios
union all select 'grupos', count(*), count(account_id) from public.grupos
union all select 'envios_grupo_lotes', count(*), count(account_id) from public.envios_grupo_lotes
union all select 'envios_grupo', count(*), count(account_id) from public.envios_grupo
union all select 'campanhas', count(*), count(account_id) from public.campanhas
union all select 'modelos_mensagem', count(*), count(account_id) from public.modelos_mensagem
union all select 'whatsapp_senders', count(*), count(account_id) from public.whatsapp_senders;
select * from public.accounts where status not in ('active','past_due','suspended','cancelled','expired','refunded');

