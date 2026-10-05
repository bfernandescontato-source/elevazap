// Vitrine: captura de produtos nas lojas (Mercado Livre, Amazon, Shopee, Magalu)
// para o carrinho da extensão. Veio da extensão "Pro" e só roda em contas
// liberadas (accounts.extensao_vitrine_enabled).

export type Loja = "ML" | "Amazon" | "Shopee" | "Magalu";

export type Produto = {
  itemId: string; platform: Loja; title: string;
  price: string; oldPrice: string; discount: string; coupon: string; installment: string;
  imageUrl: string; originalUrl: string;
  vendas?: number; freteGratis?: boolean; mercadoFull?: boolean;
  addedAt?: string;
};

/** O que cada loja sabe fazer: achar os cards da listagem, ler um card e ler a página de produto. */
export type LeitorDeLoja = {
  loja: Loja;
  cards(): Element[];
  doCard(card: Element): Produto | null;
  daPagina(): Produto | null;
  /** Captura da página inteira; a Shopee usa a busca da própria loja quando dá. */
  todosDaPagina?(): Promise<Produto[]>;
};

const LOJAS: Array<{ loja: Loja; re: RegExp }> = [
  { loja: "ML", re: /(^|\.)mercadolivre\.com(\.br)?$/ },
  { loja: "ML", re: /(^|\.)mercadolibre\.com(\.[a-z]{2})?$/ },
  { loja: "Amazon", re: /(^|\.)amazon\.com(\.br)?$/ },
  { loja: "Shopee", re: /(^|\.)shopee\.com(\.br)?$/ },
  { loja: "Magalu", re: /(^|\.)magazineluiza\.com\.br$/ },
  { loja: "Magalu", re: /(^|\.)magazinevoce\.com\.br$/ }
];

function partes(url: string = location.href) {
  try {
    const parsed = new URL(url, location.href);
    return { host: parsed.hostname.toLowerCase().replace(/^www\./, ""), caminho: parsed.pathname || "/" };
  } catch { return { host: "", caminho: "" }; }
}

export function detectarLoja(url: string = location.href): Loja | null {
  const { host } = partes(url);
  return host ? LOJAS.find(item => item.re.test(host))?.loja ?? null : null;
}

const PAGINA_DE_PRODUTO: Record<Loja, (caminho: string) => boolean> = {
  ML: caminho => /\/p\/MLB-?\d+/i.test(caminho) || /\/MLB-\d+/i.test(caminho) || /\/up\/MLBU?\d+/i.test(caminho),
  Amazon: caminho => /\/(?:dp|gp\/product|gp\/aw\/d|gp\/offer-listing)\/[A-Z0-9]{10}(?:[/?]|$)/i.test(caminho),
  Shopee: caminho => /-i\.\d+\.\d+/.test(caminho) || /\/product\/\d+\/\d+/.test(caminho),
  Magalu: caminho => /\/p\/[a-z0-9]{6,}(?:[/?]|$)/i.test(caminho)
};

export function ehPaginaDeProduto(url: string = location.href) {
  const loja = detectarLoja(url);
  return Boolean(loja && PAGINA_DE_PRODUTO[loja](partes(url).caminho));
}

/** Loja Magazine Você do afiliado (magazinevoce.com.br/<loja>/...). O link dela já é o link de afiliado. */
export function lojaMagazineVoce(url: string = location.href) {
  const { host, caminho } = partes(url);
  if (!/(^|\.)magazinevoce\.com\.br$/.test(host)) return null;
  return caminho.match(/^\/(magazine[a-z0-9_-]+)/i)?.[1] ?? null;
}

export const textOf = (element?: Element | { textContent?: string | null } | null) => (element?.textContent || "").replace(/\s+/g, " ").trim();

export function precoBR(value?: string | null) {
  const match = String(value || "").match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)/);
  return match ? `R$ ${match[1]}` : "";
}

export function dinheiro(value?: string | null) {
  const match = String(value || "").match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/);
  return match ? parseFloat(`${match[1].replace(/\./g, "")}.${match[2] || "0"}`) : NaN;
}

/** Troca a miniatura pela foto grande de cada CDN. */
export function fotoGrande(value?: string | null) {
  const url = String(value || "").replace("http://", "https://");
  if (!url) return "";
  if (/mlstatic\.com/i.test(url)) return url.replace(/-[A-Z]{1,2}\.(jpg|jpeg|png|webp)(\?.*)?$/i, "-OO.jpg");
  if (/(media|images)-amazon\.com/i.test(url)) return url.replace(/\._[^/]*_\.(jpg|jpeg|png|webp)$/i, ".$1");
  if (/mlcdn\.com\.br/i.test(url)) return url.replace(/\/\d+x\d+\//, "/1500x1500/");
  if (/susercontent|shopee\.com\.br\/file|cf\.shopee/i.test(url)) return url.replace(/_tn(\?|$)/, "$1");
  return url;
}

/** Remove os elementos que estão dentro de outro da lista (fica só o card de fora). */
export function soExternos<T extends Element>(elements: Iterable<T>) {
  const list = Array.from(elements);
  return list.filter(element => !list.some(other => other !== element && other.contains(element)));
}

/** Primeira imagem do card que não é dos nossos botões. */
export const imagemDoCard = (card: Element) => Array.from(card.querySelectorAll("img")).find(img => !img.closest(".dsp-card-btns"));

/** Desconto em % a partir do preço atual e do riscado. */
export function descontoCalculado(price: string, oldPrice: string) {
  const now = dinheiro(price); const before = dinheiro(oldPrice);
  return Number.isFinite(now) && Number.isFinite(before) && before > now && now > 0 ? `${Math.round((1 - now / before) * 100)}%` : "";
}

/** Cópia do elemento sem vitrines/recomendações, para não ler preço de outro produto. */
export function semRuido(root: Element, seletores: string) {
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll(seletores).forEach(element => element.remove());
  return clone;
}
