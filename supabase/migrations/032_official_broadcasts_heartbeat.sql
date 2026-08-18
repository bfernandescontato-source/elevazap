-- Marca quando o último lote de um disparo começou a processar. Usado para detectar
-- encadeamento (after() self-fetch) que morreu silenciosamente, permitindo que o poll
-- do admin no navegador reative o processamento sem precisar de pausar/continuar manual.
alter table official_broadcasts add column if not exists last_batch_at timestamptz;
