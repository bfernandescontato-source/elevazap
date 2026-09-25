-- Agenda do Catálogo: agendamento em massa de ofertas do Catálogo e uma aba que
-- mostra o que foi agendado manualmente (dia, horário, situação), com ações para
-- mudar horário, passar para amanhã, enviar agora e remover.
--
-- Cada oferta agendada continua sendo um lote comum de envios_grupo (o mesmo que
-- "Distribuir oferta" já cria); esta tabela só guarda o produto do lote para a
-- Agenda mostrar foto, preço e marketplace. A situação vem do próprio lote.
--
-- Liberação gradual: só contas com accounts.catalog_agenda_enabled veem a Agenda
-- e o agendamento em massa.

begin;

alter table public.accounts
  add column if not exists catalog_agenda_enabled boolean not null default false;

create table if not exists public.catalog_scheduled_offers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  lote_id uuid not null references public.envios_grupo_lotes(id) on delete cascade,
  provider text not null check (provider in ('SHOPEE','MERCADO_LIVRE','AMAZON','TIKTOK_SHOP')),
  external_item_id text not null,
  product_name text not null,
  image_url text,
  price numeric(12,2),
  original_price numeric(12,2),
  affiliate_url text,
  message text not null,
  whatsapp_sender_id uuid references public.whatsapp_senders(id) on delete set null,
  group_count integer not null check (group_count > 0),
  scheduled_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lote_id)
);

create index if not exists catalog_scheduled_offers_day_idx
  on public.catalog_scheduled_offers(account_id, scheduled_at);
create index if not exists catalog_scheduled_offers_item_idx
  on public.catalog_scheduled_offers(account_id, provider, external_item_id, scheduled_at);

alter table public.catalog_scheduled_offers enable row level security;
-- O painel grava pelo backend (service_role com filtro de conta); o aluno só lê.
create policy tenant_read on public.catalog_scheduled_offers for select to authenticated
  using (account_id=public.current_account_id() and public.current_account_is_active());

-- Muda o horário de uma oferta da Agenda: os envios ainda pendentes do lote, o
-- lote, o histórico do Catálogo e a própria linha, tudo na mesma transação. Envio
-- que já saiu ou está saindo não muda. Devolve quantos envios foram remarcados.
create or replace function public.reschedule_catalog_offer(
  p_account_id uuid,
  p_offer_id uuid,
  p_scheduled_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lote uuid;
  v_moved integer;
begin
  select offer.lote_id into v_lote
    from public.catalog_scheduled_offers offer
   where offer.id=p_offer_id and offer.account_id=p_account_id
   for update;
  if not found then
    raise exception 'Oferta não encontrada.' using errcode='P0002';
  end if;

  with moved as (
    update public.envios_grupo envio
       set scheduled_at=p_scheduled_at, next_attempt_at=null, updated_at=now()
     where envio.lote_id=v_lote and envio.account_id=p_account_id and envio.status='pendente'
    returning envio.id
  ), deliveries as (
    update public.affiliate_offer_deliveries delivery
       set scheduled_at=p_scheduled_at
     where delivery.account_id=p_account_id
       and delivery.group_dispatch_id in (select id from moved)
    returning 1
  )
  select count(*) into v_moved from moved;

  if v_moved = 0 then
    raise exception 'Esta oferta já foi enviada ou removida.' using errcode='22023';
  end if;

  update public.envios_grupo_lotes lote
     set scheduled_at=p_scheduled_at, updated_at=now()
   where lote.id=v_lote and lote.account_id=p_account_id;

  update public.catalog_scheduled_offers offer
     set scheduled_at=p_scheduled_at, updated_at=now()
   where offer.id=p_offer_id;

  return v_moved;
end;
$$;

revoke all on function public.reschedule_catalog_offer(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.reschedule_catalog_offer(uuid,uuid,timestamptz) to service_role;

notify pgrst, 'reload schema';

commit;
