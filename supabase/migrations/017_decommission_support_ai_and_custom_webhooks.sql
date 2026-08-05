-- Desativa recursos retirados da aplicação sem apagar o histórico existente.
-- Rollback operacional: reative somente registros explicitamente validados e
-- restaure o código das rotas antes de alterar estes status novamente.

update public.support_agent
set enabled = false,
    updated_at = now()
where enabled is distinct from false;

update public.webhook_rules
set status = 'inactive',
    updated_at = now()
where status is distinct from 'inactive';

comment on table public.support_agent is
  'Legado preservado para auditoria. O agente de IA foi descontinuado na migration 017.';

comment on table public.webhook_rules is
  'Legado preservado para auditoria. Webhooks personalizados foram descontinuados na migration 017.';
