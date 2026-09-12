-- Remove a assinatura antiga mantida quando resolve_campaign_redirect ganhou
-- o argumento p_rate_limit_key. Em bancos existentes, editar a migration 013
-- não a executa novamente, então a limpeza precisa ser incremental.
drop function if exists public.resolve_campaign_redirect(text, jsonb, text, text);
