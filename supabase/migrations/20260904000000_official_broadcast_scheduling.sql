-- Agendamento de disparo 1x1 (WhatsApp Oficial / Meta Cloud API): permite criar o disparo com
-- contatos e fluxo já resolvidos (mesma gravação de sempre em official_broadcast_recipients),
-- mas adiar o envio real para uma data/hora futura. O horário chega já convertido pro admin em
-- UTC (o front-end converte a partir do fuso de Brasília). O Vercel Cron chama a rota interna
-- que promove os disparos "scheduled" vencidos e retoma o processamento em lotes.
alter table public.official_broadcasts
  drop constraint if exists official_broadcasts_status_check;
alter table public.official_broadcasts
  add constraint official_broadcasts_status_check
  check (status in ('draft', 'ready', 'scheduled', 'processing', 'paused', 'completed', 'failed', 'cancelled'));

alter table public.official_broadcasts
  add column if not exists scheduled_at timestamptz;

create index if not exists official_broadcasts_scheduled_idx
  on public.official_broadcasts (scheduled_at)
  where status = 'scheduled';
