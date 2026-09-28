// Tema visual por conta (accounts.ui_theme). "classic" é o visual de sempre;
// "terra" liga html[data-theme="terra"] (cores em app/globals.css).
// Sem dependência de servidor: usado também no navegador.
export const UI_THEMES = ["classic", "terra"] as const;
export type UiTheme = typeof UI_THEMES[number];

// Cookie legível pelo navegador: o script do <head> (app/layout.tsx) aplica o
// tema antes da primeira pintura, sem piscar o visual clássico.
export const UI_THEME_COOKIE = "disparei_theme";

export function applyUiTheme(theme: UiTheme) {
  if (theme === "classic") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
