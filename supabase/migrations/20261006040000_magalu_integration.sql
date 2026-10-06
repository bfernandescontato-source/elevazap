-- Magalu paga afiliado só pela loja Magazine Você; guardamos o slug como integração.
alter table public.affiliate_integrations drop constraint if exists affiliate_integrations_provider_check;
alter table public.affiliate_integrations add constraint affiliate_integrations_provider_check
  check (provider in ('shopee','mercado_livre','amazon','magalu'));
