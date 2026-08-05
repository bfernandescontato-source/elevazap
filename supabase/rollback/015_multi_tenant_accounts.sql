-- Rollback for migration 015. Only valid before onboarding a second account.
-- It aborts rather than deleting tenant data.
do $$
begin
  if (select count(*) from public.accounts) > 1 then
    raise exception 'Rollback blocked: more than one account exists. Restore the logical backup instead.';
  end if;
end $$;

drop trigger if exists tenant_campaign_group on public.campanha_grupos;
drop trigger if exists tenant_model_folder on public.modelos_mensagem;
drop trigger if exists tenant_group_item_batch on public.envios_grupo;
drop trigger if exists tenant_webhook_template on public.webhook_message_templates;
drop trigger if exists tenant_support_conversation on public.support_conversation;
drop trigger if exists tenant_support_message on public.support_message;
drop trigger if exists tenant_support_kb on public.support_kb;
drop trigger if exists tenant_refund_conversation on public.refund_request;
drop trigger if exists tenant_sender_group on public.whatsapp_sender_grupos;
drop function if exists public.enforce_same_account();

-- Restoring the complete pre-015 functions and policies is intentionally done
-- from the logical backup or by reapplying migrations 001-014 in a clean DB.
-- Dropping account_id columns here would destroy tenant ownership metadata, so
-- this script deliberately does not perform that irreversible operation.
