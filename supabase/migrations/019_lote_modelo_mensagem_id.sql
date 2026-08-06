-- Add modelo_mensagem_id to envios_grupo_lotes so the lotes list can show
-- which message model was used for each dispatch batch.
alter table public.envios_grupo_lotes
  add column if not exists modelo_mensagem_id uuid references public.modelos_mensagem(id) on delete set null;

create index if not exists envios_grupo_lotes_modelo_idx
  on public.envios_grupo_lotes(modelo_mensagem_id)
  where modelo_mensagem_id is not null;
