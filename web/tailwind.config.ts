import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

// Cores do painel vêm de variáveis CSS (canais RGB) definidas em app/globals.css.
// O valor depois da vírgula é o tema clássico: sem a variável, a cor é a de sempre.
// Um tema (ex.: html[data-theme="terra"]) só redefine as variáveis.
const channels = (hex: string) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)).join(" ");
};
const token = (name: string, fallback: string) => `rgb(var(--c-${name}, ${channels(fallback)}) / <alpha-value>)`;

// Escalas padrão do Tailwind (emerald-50…950 etc.) com a mesma troca por variável.
const scale = (family: keyof typeof colors) => Object.fromEntries(
  Object.entries(colors[family] as Record<string, string>).map(([step, hex]) => [step, `rgb(var(--c-${family}-${step}, ${channels(hex)}) / <alpha-value>)`])
);
const themedFamilies = ["slate", "gray", "zinc", "neutral", "stone", "red", "orange", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"] as const;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries(themedFamilies.map(family => [family, scale(family)])),
        white: token("white", "#ffffff"),
        black: token("black", "#000000"),
        ink: token("ink", "#111111"),
        muted: token("muted", "#666666"),
        line: token("line", "#e5e5e5"),
        panel: token("panel", "#ffffff"),
        wash: token("wash", "#f7f7f7"),
        accent: token("accent", "#111111"),
        coral: token("coral", "#cc5b45"),
        // A escala amber-50…950 não existe no tema clássico (esta chave única a
        // substitui); o tema terra gera essas classes em app/globals.css.
        amber: token("amber", "#ad7a19"),
        // Ação principal (botões, item selecionado, marcadores): preto no clássico.
        primary: {
          DEFAULT: token("primary", "#000000"),
          hover: token("primary-hover", "#27272a"),
          fg: token("primary-fg", "#ffffff")
        },
        // Item ativo da barra de navegação do celular.
        nav: {
          DEFAULT: token("nav", "#111111"),
          soft: token("nav-soft", "#f4f4f5")
        },
        // Lilás suave de apoio (card Grupos, Incertos) — usado só no tema terra.
        lilac: {
          DEFAULT: token("lilac", "#8e7cc3"),
          soft: token("lilac-soft", "#f1eef8")
        },
        // Selo "NOVO" do menu lateral.
        badge: {
          DEFAULT: token("badge", "#d1fae5"),
          fg: token("badge-fg", "#047857")
        },
        // Fundo escuro atrás de janelas e menus.
        overlay: token("overlay", "#000000"),
        // Anel de foco e marcação do item ativo do menu.
        focus: token("focus", "#2563eb"),
        // Tons de informação da tela Shopee Analytics.
        info: {
          DEFAULT: token("info", "#2563eb"),
          soft: token("info-soft", "#eff6ff"),
          line: token("info-line", "#dce7f7"),
          strong: token("info-strong", "#bfdbfe"),
          ok: token("info-ok", "#10b981"),
          pending: token("info-pending", "#f59e0b")
        }
      },
      boxShadow: {
        soft: "0 12px 32px rgb(var(--c-shadow, 0 0 0) / 0.06)"
      }
    }
  },
  plugins: [
    // terra:… só vale com html[data-theme="terra"]: elementos e estilos extras da
    // nova identidade que não existem no visual clássico.
    plugin(({ addVariant }) => { addVariant("terra", 'html[data-theme="terra"] &'); })
  ]
};

export default config;
