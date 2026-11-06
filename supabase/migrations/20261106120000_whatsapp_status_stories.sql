-- Stories 9:16 no Status do WhatsApp (fase 2).
--
-- A postagem no Status é um envio comum da fila de grupos (public.envios_grupo)
-- com group_jid = 'status@broadcast'. O whatsapp-service monta a lista de quem
-- vê a partir dos grupos gravados em status_audience_jids.
--
-- Idempotente: pode rodar mais de uma vez. Não reescreve linhas existentes
-- (colunas novas são nulas ou com padrão constante; a checagem nasce NOT VALID).
--
-- Objetos de produção que esta migration assume existir:
--   public.accounts (id uuid), public.envios_grupo (id, account_id, group_jid,
--   status), RLS já ligada em envios_grupo com a política tenant_isolation.

-- 1) Liberação por conta. Nasce desligada para todas; liga-se à mão por conta.
--    accounts só tem política de leitura para authenticated: o aluno não altera.
alter table public.accounts
  add column if not exists whatsapp_status_enabled boolean not null default false;

-- 2) Grupos cujos participantes verão o story (máximo 5).
alter table public.envios_grupo
  add column if not exists status_audience_jids text[];

alter table public.envios_grupo drop constraint if exists envios_grupo_status_audience_check;
alter table public.envios_grupo add constraint envios_grupo_status_audience_check
  check (
    group_jid <> 'status@broadcast'
    or (tipo = 'imagem' and status_audience_jids is not null and cardinality(status_audience_jids) between 1 and 5)
  ) not valid;

-- 3) A liberação vale também para quem grava direto pela API com o próprio login
--    (a política tenant_isolation permite insert na própria conta).
create or replace function public.enforce_whatsapp_status_enabled()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.group_jid = 'status@broadcast' and not exists (
    select 1 from public.accounts a where a.id = new.account_id and a.whatsapp_status_enabled
  ) then
    raise exception 'Postar no Status não está liberado para esta conta.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists enforce_whatsapp_status_enabled on public.envios_grupo;
create trigger enforce_whatsapp_status_enabled
  before insert on public.envios_grupo
  for each row when (new.group_jid = 'status@broadcast')
  execute function public.enforce_whatsapp_status_enabled();

-- Sem índice novo: a contagem do limite diário filtra por group_jid, que já tem
-- índice (envios_grupo_group_jid_idx), e criar índice trava a fila durante a varredura.
