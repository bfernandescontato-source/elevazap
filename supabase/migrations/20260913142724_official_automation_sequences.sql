-- Generaliza o follow-up único (clique) de uma automação para uma sequência de N etapas,
-- cada uma disparada por clique (mensagem livre) ou por atraso de tempo (template, via cron).
-- Não altera nada do caminho existente (followup_mode 'legacy'/'button'/'none' continuam
-- funcionando sem mudança) — apenas adiciona o modo 'sequence' e a infraestrutura de agendamento.

alter table public.official_automations
  add column if not exists followup_steps jsonb not null default '[]'::jsonb;

-- O nome da constraint inline criada em 20260830213000 não foi fixado explicitamente ali,
-- então localizamos e removemos dinamicamente em vez de assumir o nome padrão do Postgres.
do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname = 'official_automations'
    and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%followup_mode%';
  if v_constraint_name is not null then
    execute format('alter table public.official_automations drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.official_automations
  add constraint official_automations_followup_mode_check
  check (followup_mode in ('legacy', 'none', 'button', 'sequence'));

-- Quando a próxima etapa aguardada é por atraso, guarda o instante em que fica devida.
-- NULL enquanto a etapa aguardada for por clique (comportamento atual, sem mudança).
-- automation_step_claimed_at é setado explicitamente pelo claim abaixo (não existe trigger de
-- updated_at nesta tabela — updated_at só é tocado por applyMetaMessageStatus, então não serve
-- para detectar uma reivindicação travada).
alter table public.official_messages
  add column if not exists automation_step_due_at timestamptz,
  add column if not exists automation_step_claimed_at timestamptz;

create index if not exists official_messages_due_followups_idx
  on public.official_messages(automation_step_due_at)
  where automation_reply_state = 'waiting' and automation_step_due_at is not null;

-- Reivindica atomicamente as mensagens cuja próxima etapa por atraso já venceu, para o cron
-- processar. Espelha claim_due_official_broadcasts (20260904001000): FOR UPDATE SKIP LOCKED
-- evita processar a mesma linha duas vezes mesmo com o cron rodando em mais de uma instância.
create or replace function public.claim_due_official_followups(
  p_limit integer default 20,
  p_stale_seconds integer default 120
) returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Uma tentativa interrompida é ambígua: a Meta pode ter aceitado o envio antes da queda.
  -- Falha sem reenviar é a única escolha que preserva a garantia de não duplicidade.
  update public.official_messages m
  set automation_reply_state = 'failed',
      error = coalesce(m.error, 'UNCERTAIN_DELIVERY: processamento interrompido; não reenviado para evitar duplicidade.'),
      failed_at = coalesce(m.failed_at, clock_timestamp())
  where m.automation_reply_state = 'sending'
    and m.automation_step_due_at is not null
    and m.automation_step_claimed_at < clock_timestamp() - make_interval(secs => p_stale_seconds);

  return query
  with candidates as (
    select m.id
    from public.official_messages m
    where m.automation_reply_state = 'waiting'
      and m.automation_step_due_at is not null
      and m.automation_step_due_at <= clock_timestamp()
    order by m.automation_step_due_at
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.official_messages m
  set automation_reply_state = 'sending',
      automation_step_claimed_at = clock_timestamp()
  from candidates c
  where m.id = c.id
  returning m.id;
end;
$$;

revoke all on function public.claim_due_official_followups(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_due_official_followups(integer, integer) to service_role;
