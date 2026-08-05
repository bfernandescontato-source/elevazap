-- Save this output with the logical backup before applying migration 015.
select 'app_users' table_name, count(*) rows from public.app_users
union all select 'envios', count(*) from public.envios
union all select 'grupos', count(*) from public.grupos
union all select 'envios_grupo_lotes', count(*) from public.envios_grupo_lotes
union all select 'envios_grupo', count(*) from public.envios_grupo
union all select 'campanhas', count(*) from public.campanhas
union all select 'modelos_mensagem', count(*) from public.modelos_mensagem
union all select 'whatsapp_senders', count(*) from public.whatsapp_senders;

