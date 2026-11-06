// Endereço público da vitrine: /v/<slug>. Mesma regra do banco
// (offer_page_settings_slug_format): 3 a 40 caracteres, letras minúsculas,
// números e hífen só entre partes.

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Palavras que confundem com o próprio Disparei, com rotas do painel ou com
// páginas de golpe ("suporte", "oficial"). Comparadas sem hífen.
const RESERVED = new Set([
  "admin", "administrador", "api", "app", "auth", "login", "logout", "entrar", "sair", "cadastro", "conta", "senha",
  "recuperarsenha", "redefinirsenha", "magiclink", "dashboard", "home", "inicio", "configuracoes", "catalogo", "cupons",
  "campanhas", "disparos", "envios", "enviosgrupo", "grupos", "lotes", "mensagem", "conexao", "incertos", "incidentes",
  "integracoes", "comunidade", "analytics", "pilotoautomatico", "piloto", "baixarextensao", "extensao", "suporte", "ajuda",
  "help", "contato", "oficial", "disparei", "elevazap", "vitrine", "loja", "lojas", "ofertas", "oferta", "www", "mail",
  "email", "root", "null", "undefined", "teste", "test", "static", "public", "assets", "next", "favicon", "robots", "sitemap",
  "shopee", "amazon", "mercadolivre", "magalu", "whatsapp", "instagram", "pagamento", "pix", "termos", "privacidade"
]);

/** Sugestão de endereço a partir de um nome ("Ana Lúcia Achados" -> "ana-lucia-achados"). */
export function slugify(value: string) {
  return value
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

export type SlugCheck = { ok: true; slug: string } | { ok: false; error: string };

export function validateSlug(raw: string): SlugCheck {
  const slug = String(raw || "").trim().toLowerCase();
  if (slug.length < SLUG_MIN) return { ok: false, error: `Use pelo menos ${SLUG_MIN} caracteres.` };
  if (slug.length > SLUG_MAX) return { ok: false, error: `Use no máximo ${SLUG_MAX} caracteres.` };
  if (!SLUG_PATTERN.test(slug)) return { ok: false, error: "Use só letras sem acento, números e hífen entre as palavras." };
  if (RESERVED.has(slug.replace(/-/g, ""))) return { ok: false, error: "Esse endereço é reservado. Escolha outro." };
  return { ok: true, slug };
}

/** Enquanto a pessoa digita: mesma limpeza do slugify, mas mantém o hífen do fim. */
export function normalizeSlugInput(value: string) {
  return value
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX);
}
