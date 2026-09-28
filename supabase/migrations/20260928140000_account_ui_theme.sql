-- Tema visual do painel por conta. "classic" = visual de sempre; "terra" = nova
-- identidade (areia, espresso, teal, coral, oliva, âmbar, terracota).
-- Lido por /api/ui-theme (web/lib/ui-theme.ts). Aplicada em produção em 28/09/2026.
alter table public.accounts add column if not exists ui_theme text not null default 'classic';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_ui_theme_check') then
    alter table public.accounts add constraint accounts_ui_theme_check check (ui_theme in ('classic', 'terra'));
  end if;
end $$;
