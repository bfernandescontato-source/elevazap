-- Conversão Mercado Livre pelo servidor (sem depender do Chrome aberto): a
-- extensão envia os cookies da sessão ML do afiliado, guardados com AES-256-GCM
-- (mesma chave das demais integrações). session_status vira 'invalid' quando o
-- ML recusa a sessão; aí o Piloto volta a usar a fila da extensão.
alter table public.affiliate_integrations add column if not exists encrypted_session_cookies text;
alter table public.affiliate_integrations add column if not exists session_synced_at timestamptz;
alter table public.affiliate_integrations add column if not exists session_status text;
alter table public.affiliate_integrations drop constraint if exists affiliate_integrations_session_status_check;
alter table public.affiliate_integrations add constraint affiliate_integrations_session_status_check
  check (session_status is null or session_status in ('ok', 'invalid'));
