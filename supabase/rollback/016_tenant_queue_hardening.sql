begin;
alter table public.envios drop constraint if exists envios_active_job_requires_session;
alter table public.envios_grupo drop constraint if exists envios_grupo_active_job_requires_session;
-- Reapply migration 015 to restore the previous claim functions after this rollback.
commit;

