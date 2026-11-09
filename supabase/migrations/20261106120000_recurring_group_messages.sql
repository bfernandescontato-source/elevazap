-- Mensagens automáticas: até 5 mensagens por conta que se repetem todo dia
-- (avisos, regras, convite do grupo), com até 5 horários por dia, dias da semana
-- e liga/desliga.
--
-- Cada ocorrência vira um lote comum de envios_grupo (as mesmas colunas que
-- /api/lotes/create grava), então a fila, o painel de Programados, o cancelamento
-- e a limpeza de mídia continuam iguais. Ninguém envia direto daqui.
--
-- Materialização: sempre "hoje + amanhã" no fuso de São Paulo (sem horário de
-- verão desde 2019). Roda quando o aluno salva (painel) e num laço curto do
-- whatsapp-service (materialize_due_recurring_group_messages). A tabela de
-- ocorrências tem chave única (mensagem, data local, horário local): a mesma
-- ocorrência nunca gera dois lotes, mesmo com as duas chamadas ao mesmo tempo.
--
-- Objetos de produção que este arquivo pressupõe (conferir antes de aplicar):
--   public.accounts(id uuid, status text)                       ('active' = ativa)
--   public.whatsapp_senders(id uuid, account_id uuid, session_name text)
--   public.grupos(account_id uuid, group_jid text, nome text)
--   public.envios_grupo_lotes(id, account_id, titulo, whatsapp_sender_id,
--       whatsapp_session_name, tipo, texto, legenda, mention_all, media_bucket,
--       media_path, file_name, mime_type, file_size_bytes, status, priority,
--       total, pendentes, scheduled_at, updated_at)
--   public.envios_grupo(id, account_id, lote_id, whatsapp_sender_id,
--       whatsapp_session_name, group_jid, nome_grupo, tipo, texto, legenda,
--       mention_all, media_bucket, media_path, file_name, mime_type,
--       file_size_bytes, status, priority, scheduled_at, claim_token, updated_at)
--   public.recalc_lote_counts(p_lote_id uuid) returns void
--   public.current_account_id() returns uuid
--   public.current_account_is_active() returns boolean
--   gatilhos atuais de envios_grupo (sync_whatsapp_session_id, enforce_same_account)
--
-- Idempotente: pode rodar de novo sem efeito colateral.

begin;

create table if not exists public.recurring_group_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  tipo text not null default 'texto' check (tipo in ('texto', 'imagem')),
  texto text not null default '' check (char_length(texto) <= 4096),
  media_bucket text,
  media_path text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  whatsapp_sender_id uuid references public.whatsapp_senders(id) on delete set null,
  group_jids text[] not null check (cardinality(group_jids) between 1 and 500),
  horarios time[] not null check (cardinality(horarios) between 1 and 5),
  dias_semana smallint[] not null check (cardinality(dias_semana) between 1 and 7 and dias_semana <@ array[1,2,3,4,5,6,7]::smallint[]),
  ativo boolean not null default true,
  -- Último dia local (São Paulo) já materializado; null = materializar de novo.
  materialized_through date,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tipo = 'texto' or (media_bucket is not null and media_path is not null))
);

create index if not exists recurring_group_messages_account_idx
  on public.recurring_group_messages(account_id, created_at);
create index if not exists recurring_group_messages_due_idx
  on public.recurring_group_messages(materialized_through nulls first)
  where ativo;
-- Exclusão de número não pode varrer a tabela inteira.
create index if not exists recurring_group_messages_sender_idx
  on public.recurring_group_messages(whatsapp_sender_id)
  where whatsapp_sender_id is not null;

create table if not exists public.recurring_group_message_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  recurring_message_id uuid not null references public.recurring_group_messages(id) on delete cascade,
  local_date date not null,
  local_time time not null,
  scheduled_at timestamptz not null,
  lote_id uuid references public.envios_grupo_lotes(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (recurring_message_id, local_date, local_time)
);

create index if not exists recurring_group_message_runs_lote_idx
  on public.recurring_group_message_runs(lote_id) where lote_id is not null;
create index if not exists recurring_group_message_runs_account_idx
  on public.recurring_group_message_runs(account_id, scheduled_at);

alter table public.recurring_group_messages enable row level security;
alter table public.recurring_group_message_runs enable row level security;

-- O painel grava pelo backend (service_role com filtro de conta); o aluno só lê.
drop policy if exists tenant_read on public.recurring_group_messages;
create policy tenant_read on public.recurring_group_messages for select to authenticated
  using (account_id = public.current_account_id() and public.current_account_is_active());
drop policy if exists tenant_read on public.recurring_group_message_runs;
create policy tenant_read on public.recurring_group_message_runs for select to authenticated
  using (account_id = public.current_account_id() and public.current_account_is_active());

revoke all on public.recurring_group_messages from anon;
revoke all on public.recurring_group_message_runs from anon;
revoke insert, update, delete on public.recurring_group_messages from authenticated;
revoke insert, update, delete on public.recurring_group_message_runs from authenticated;

-- No máximo 5 mensagens por conta (o painel também confere; aqui vale mesmo com
-- dois cliques ao mesmo tempo).
create or replace function public.enforce_recurring_group_messages_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('recurring_group_messages:' || new.account_id::text, 0));
  if (select count(*) from public.recurring_group_messages m where m.account_id = new.account_id) >= 5 then
    raise exception 'Limite de 5 mensagens automáticas por conta.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists recurring_group_messages_limit on public.recurring_group_messages;
create trigger recurring_group_messages_limit
before insert on public.recurring_group_messages
for each row execute function public.enforce_recurring_group_messages_limit();

-- Cancela as ocorrências futuras que ainda não começaram (todos os envios do lote
-- ainda "pendente") e apaga a ocorrência, para poder recriar com o texto novo.
-- Lote já reivindicado pela fila fica como está. Devolve quantos lotes cancelou.
create or replace function public.cancel_pending_recurring_group_message_runs(
  p_account_id uuid,
  p_message_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run record;
  v_started integer;
  v_cancelled integer := 0;
begin
  for v_run in
    select run.id, run.lote_id
      from public.recurring_group_message_runs run
     where run.account_id = p_account_id
       and run.recurring_message_id = p_message_id
       and run.scheduled_at > now()
     order by run.scheduled_at
     limit 20
  loop
    if v_run.lote_id is null then
      delete from public.recurring_group_message_runs where id = v_run.id;
      continue;
    end if;
    -- Trava os envios do lote: a fila não reivindica linha travada.
    perform 1 from public.envios_grupo envio
      where envio.lote_id = v_run.lote_id and envio.account_id = p_account_id
      for update;
    select count(*) into v_started
      from public.envios_grupo envio
     where envio.lote_id = v_run.lote_id and envio.account_id = p_account_id
       and envio.status <> 'pendente';
    if v_started > 0 then continue; end if;

    update public.envios_grupo
       set status = 'cancelado', claim_token = null, erro = 'Mensagem automática alterada ou desligada.', updated_at = now()
     where lote_id = v_run.lote_id and account_id = p_account_id and status = 'pendente';
    perform public.recalc_lote_counts(v_run.lote_id);
    update public.envios_grupo_lotes
       set status = 'cancelado', updated_at = now()
     where id = v_run.lote_id and account_id = p_account_id;
    delete from public.recurring_group_message_runs where id = v_run.id;
    v_cancelled := v_cancelled + 1;
  end loop;

  update public.recurring_group_messages
     set materialized_through = null, updated_at = now()
   where id = p_message_id and account_id = p_account_id;
  return v_cancelled;
end;
$$;

-- Cria os lotes das ocorrências de hoje e amanhã (São Paulo) que ainda não
-- existem. Horário que já passou (ou falta menos de 1 minuto) não é criado.
-- Devolve quantos lotes criou.
create or replace function public.materialize_recurring_group_message(
  p_account_id uuid,
  p_message_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_msg public.recurring_group_messages%rowtype;
  v_sender record;
  v_group_count integer;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_day date;
  v_time time;
  v_at timestamptz;
  v_run_id uuid;
  v_lote_id uuid;
  v_created integer := 0;
  v_legenda text;
begin
  -- Trava a mensagem: painel e laço periódico não materializam a mesma ao mesmo tempo.
  select * into v_msg
    from public.recurring_group_messages m
   where m.id = p_message_id and m.account_id = p_account_id
   for update;
  if not found then return 0; end if;

  if not v_msg.ativo or not exists (
    select 1 from public.accounts a where a.id = p_account_id and a.status = 'active'
  ) then
    update public.recurring_group_messages set materialized_through = v_today + 1 where id = v_msg.id;
    return 0;
  end if;

  select s.id, s.session_name into v_sender
    from public.whatsapp_senders s
   where s.id = v_msg.whatsapp_sender_id and s.account_id = p_account_id;
  if not found or nullif(v_sender.session_name, '') is null then
    update public.recurring_group_messages
       set materialized_through = v_today + 1, last_error = 'O número escolhido não existe mais. Escolha outro número.'
     where id = v_msg.id;
    return 0;
  end if;

  select count(*) into v_group_count
    from public.grupos g
   where g.account_id = p_account_id and g.group_jid = any(v_msg.group_jids);
  if v_group_count = 0 then
    update public.recurring_group_messages
       set materialized_through = v_today + 1, last_error = 'Nenhum dos grupos escolhidos foi encontrado.'
     where id = v_msg.id;
    return 0;
  end if;

  v_legenda := case when v_msg.tipo = 'imagem' then v_msg.texto else null end;

  foreach v_day in array array[v_today, v_today + 1] loop
    if not (extract(isodow from v_day)::smallint = any(v_msg.dias_semana)) then continue; end if;
    foreach v_time in array v_msg.horarios loop
      v_at := (v_day + v_time) at time zone 'America/Sao_Paulo';
      if v_at <= now() + interval '1 minute' then continue; end if;

      v_run_id := null;
      insert into public.recurring_group_message_runs(account_id, recurring_message_id, local_date, local_time, scheduled_at)
      values (p_account_id, v_msg.id, v_day, v_time, v_at)
      on conflict (recurring_message_id, local_date, local_time) do nothing
      returning id into v_run_id;
      if v_run_id is null then continue; end if;

      insert into public.envios_grupo_lotes(
        account_id, titulo, whatsapp_sender_id, whatsapp_session_name, tipo, texto, legenda, mention_all,
        media_bucket, media_path, file_name, mime_type, file_size_bytes, status, priority, total, pendentes, scheduled_at
      ) values (
        p_account_id, left('Automática · ' || v_msg.nome, 120), v_sender.id, v_sender.session_name, v_msg.tipo, v_msg.texto, v_legenda, false,
        v_msg.media_bucket, v_msg.media_path, v_msg.file_name, v_msg.mime_type, v_msg.file_size_bytes, 'pendente', 'high', v_group_count, v_group_count, v_at
      ) returning id into v_lote_id;

      insert into public.envios_grupo(
        account_id, lote_id, whatsapp_sender_id, whatsapp_session_name, group_jid, nome_grupo, tipo, texto, legenda, mention_all,
        media_bucket, media_path, file_name, mime_type, file_size_bytes, status, priority, scheduled_at
      )
      select p_account_id, v_lote_id, v_sender.id, v_sender.session_name, g.group_jid, coalesce(g.nome, g.group_jid), v_msg.tipo, v_msg.texto, v_legenda, false,
             v_msg.media_bucket, v_msg.media_path, v_msg.file_name, v_msg.mime_type, v_msg.file_size_bytes, 'pendente', 'high', v_at
        from public.grupos g
       where g.account_id = p_account_id and g.group_jid = any(v_msg.group_jids);

      update public.recurring_group_message_runs set lote_id = v_lote_id where id = v_run_id;
      v_created := v_created + 1;
    end loop;
  end loop;

  update public.recurring_group_messages
     set materialized_through = v_today + 1, last_error = null
   where id = v_msg.id;
  return v_created;
end;
$$;

-- Laço periódico (whatsapp-service): poucas mensagens por chamada, para cada
-- chamada ficar bem abaixo de 8 s. Quem chama repete enquanto vier o limite cheio.
-- Devolve quantas mensagens processou.
create or replace function public.materialize_due_recurring_group_messages(p_limit integer default 3)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tomorrow date := (now() at time zone 'America/Sao_Paulo')::date + 1;
  v_msg record;
  v_done integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'Limite inválido.' using errcode = '22023';
  end if;
  for v_msg in
    select m.id, m.account_id
      from public.recurring_group_messages m
     where m.ativo and (m.materialized_through is null or m.materialized_through < v_tomorrow)
     order by m.materialized_through nulls first, m.id
     limit p_limit
     for update skip locked
  loop
    perform public.materialize_recurring_group_message(v_msg.account_id, v_msg.id);
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.enforce_recurring_group_messages_limit() from public, anon, authenticated;
revoke all on function public.cancel_pending_recurring_group_message_runs(uuid, uuid) from public, anon, authenticated;
revoke all on function public.materialize_recurring_group_message(uuid, uuid) from public, anon, authenticated;
revoke all on function public.materialize_due_recurring_group_messages(integer) from public, anon, authenticated;
grant execute on function public.cancel_pending_recurring_group_message_runs(uuid, uuid) to service_role;
grant execute on function public.materialize_recurring_group_message(uuid, uuid) to service_role;
grant execute on function public.materialize_due_recurring_group_messages(integer) to service_role;

commit;
