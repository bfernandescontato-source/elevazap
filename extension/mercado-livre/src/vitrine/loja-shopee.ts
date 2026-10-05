import { VITRINE_BUSCA_SHOPEE } from "../shared.js";
import { dinheiro, ehPaginaDeProduto, fotoGrande, imagemDoCard, precoBR, semRuido, soExternos, textOf, type LeitorDeLoja, type Produto } from "./lojas.js";

const idDoProduto = (value?: string | null) => {
  const match = (value || "").match(/-i\.(\d+)\.(\d+)/) || (value || "").match(/\/product\/(\d+)\/(\d+)/);
  return match ? `${match[1]}_${match[2]}` : null;
};
const CDN = /susercontent|shopee\.com\.br\/file|cf\.shopee/i;
const LINK_DE_PRODUTO = "a[href*=\"-i.\"], a[href*=\"/product/\"]";
const RISCADO = "[class*=\"line-through\"], del, [class*=\"original-price\"]";
const RUIDO_DA_PDP = [".recommendation-fixed-container", ".shopee-search-item-result__items--recommend", "[class*=\"recommend\" i]", "[class*=\"also-like\" i]", "footer"].join(",");

function cupom(root: Element | Document, price: string) {
  const leaves = Array.from(root.querySelectorAll("*")).filter(element => element.children.length === 0 && /cupom|voucher/i.test(element.textContent || ""));
  for (const leaf of leaves) {
    let block: Element | null = leaf;
    for (let level = 0; level < 4 && block; level++) {
      const text = textOf(block);
      const percent = text.match(/(\d{1,3})\s*%\s*(?:OFF|de desconto|desconto)/i);
      if (percent) return `${percent[1]}% OFF`;
      const money = text.match(/R\$\s*\d+(?:[,.]\d{1,2})?\s*(?:OFF|de desconto)/i);
      if (money) return money[0].toUpperCase().replace(/\s+/g, " ").trim();
      const withCoupon = text.match(/(R\$\s*\d+(?:[,.]\d{1,2})?)\s*com\s+cupom/i)?.[1];
      if (withCoupon && price) { const off = dinheiro(price) - dinheiro(withCoupon); if (Number.isFinite(off) && off >= 1) return `R$ ${off.toFixed(2).replace(".", ",")} OFF`; }
      block = block.parentElement;
    }
  }
  return "";
}

const fundo = (element: Element) => getComputedStyle(element).backgroundImage.match(/url\((['"]?)(.*?)\1\)/)?.[2] || "";

function imagem(card: Element) {
  const img = imagemDoCard(card);
  const source = img?.getAttribute("src") || img?.getAttribute("data-src") || "";
  if (source && CDN.test(source)) return fotoGrande(source);
  // A Shopee às vezes desenha a foto como fundo de uma div.
  for (const element of Array.from(card.querySelectorAll("*"))) {
    if (element.closest(".dsp-card-btns")) continue;
    const background = fundo(element);
    if (background && CDN.test(background)) return fotoGrande(background);
  }
  return fotoGrande(source);
}

function cards() {
  const found = new Set<Element>();
  document.querySelectorAll(LINK_DE_PRODUTO).forEach(anchor => {
    const href = anchor.getAttribute("href") || "";
    if (!/-i\.\d+\.\d+/.test(href) && !/\/product\/\d+\/\d+/.test(href)) return;
    let block: Element | null = anchor; let card: Element | null = null;
    for (let level = 0; level < 8 && block && block !== document.body; level++) {
      if (block.tagName === "LI") { card = block; break; }
      if (block.querySelector("img, picture, [class*=\"image\" i], [style*=\"background-image\"]")) {
        const box = block.getBoundingClientRect();
        if (box.width >= 120 && box.height >= 140 && box.width < 600) { card = block; break; }
      }
      block = block.parentElement;
    }
    found.add(card || anchor);
  });
  return soExternos(found);
}

function doCard(card: Element): Produto | null {
  if (card.closest(".shopee-search-item-result__items--recommend, .recommendation-fixed-container")) return null;
  const link = card.matches(LINK_DE_PRODUTO) ? card : card.querySelector(LINK_DE_PRODUTO);
  const href = link?.getAttribute("href") || "";
  const url = href ? new URL(href, location.origin).href.split("?")[0] : "";
  const itemId = idDoProduto(url);
  if (!itemId || !url) return null;
  const fromAria = (link?.getAttribute("aria-label") || "").match(/^(.*?)\s+promoção/)?.[1]?.replace(/\s+(null|Vendedor Internacional)$/, "");
  const title = textOf(card.querySelector("[class*=\"line-clamp\"], [class*=\"title\"], [data-sqe=\"name\"]")) || (fromAria || "").trim() || (imagemDoCard(card)?.getAttribute("alt") || "").trim();
  if (!title) return null;
  const allText = textOf(card);
  let price = precoBR(textOf(card.querySelector("[class*=\"price\"]:not([class*=\"dsp-\"]), [class*=\"Price\"]:not([class*=\"dsp-\"]), [aria-label*=\"preço\" i], [aria-label*=\"price\" i]")));
  if (!price) price = precoBR(textOf(semRuido(card, RISCADO)));
  if (!price) price = precoBR(allText);
  const oldPrice = precoBR(textOf(card.querySelector(RISCADO)));
  let discount = textOf(card.querySelector("[class*=\"percent\"], [class*=\"discount\"], [class*=\"Discount\"]")).match(/(\d{1,3})\s*%/)?.[1] || allText.match(/-\s*(\d{1,3})\s*%/)?.[1] || "";
  if (!discount && oldPrice && price) { const before = dinheiro(oldPrice); const now = dinheiro(price); if (before > now && now > 0) discount = String(Math.round((before - now) / before * 100)); }
  return { itemId, platform: "Shopee", title, price, oldPrice, discount: discount ? `${discount}%` : "", coupon: cupom(card, price), installment: "", imageUrl: imagem(card), originalUrl: url };
}

function daPagina(): Produto | null {
  const itemId = idDoProduto(location.pathname);
  if (!itemId) return null;
  const body = semRuido(document.body, RUIDO_DA_PDP);
  let price = precoBR(textOf(body.querySelector("[class*=\"pmmxKx\"], [class*=\"price\"]:not([class*=\"dsp-\"]), [class*=\"Price\"]:not([class*=\"dsp-\"])")));
  if (!price) {
    const leaf = Array.from(body.querySelectorAll("*")).find(element => element.children.length === 0 && /^R\$\s?\d[\d.,]*$/.test((element.textContent || "").trim()) && !element.closest("[class*=\"dsp-\"]") && !element.closest("del, s, [class*=\"line-through\" i], [class*=\"strike\" i]"));
    if (leaf) price = precoBR(leaf.textContent);
  }
  const oldPrice = precoBR(textOf(body.querySelector("[class*=\"line-through\"], del")));
  const before = dinheiro(oldPrice); const now = dinheiro(price);
  const carouselBackground = document.querySelector("[class*=\"carousel\"] [style*=\"background\"]");
  return {
    itemId, platform: "Shopee", title: textOf(document.querySelector("h1, [class*=\"attM6y\"], [class*=\"product-title\"]")), price, oldPrice,
    discount: before > now && now > 0 ? `${Math.round((before - now) / before * 100)}%` : "", coupon: cupom(document, price), installment: "",
    imageUrl: fotoGrande(document.querySelector<HTMLMetaElement>("meta[property=\"og:image\"]")?.content || document.querySelector<HTMLImageElement>("picture img, [class*=\"carousel\"] img")?.src || (carouselBackground ? fundo(carouselBackground) : "")),
    originalUrl: location.href.split("?")[0]
  };
}

/** Busca ou categoria da página atual, no formato da API de busca da Shopee. */
function filtroDaListagem(): Record<string, string> | null {
  const category = location.pathname.match(/-cat\.(\d+)/);
  if (category) return { match_id: category[1], scenario: "PAGE_CATEGORY", by: "relevancy" };
  const keyword = /^\/search/.test(location.pathname) ? new URLSearchParams(location.search).get("keyword") : null;
  return keyword ? { keyword, scenario: "PAGE_GLOBAL_SEARCH", by: "relevancy" } : null;
}

const MOEDA_SHOPEE = 100000; // a API devolve preço em centavos * 1000
const precoDaApi = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? `R$ ${(number / MOEDA_SHOPEE).toFixed(2).replace(".", ",")}` : ""; };

function produtoDaApi(entry: any): Produto | null {
  const item = entry?.item_basic || entry;
  if (!item?.itemid || !item?.shopid) return null;
  const price = precoDaApi(item.price); const before = precoDaApi(item.price_before_discount);
  const onSale = Boolean(before && price && item.price_before_discount > item.price);
  const slug = String(item.name || "").trim().replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 60);
  return {
    itemId: `${item.shopid}_${item.itemid}`, platform: "Shopee", title: String(item.name || "").trim(), price,
    oldPrice: onSale ? before : "", discount: onSale ? `${Math.round((item.price_before_discount - item.price) / item.price_before_discount * 100)}%` : "",
    coupon: "", installment: "", imageUrl: item.image ? `https://down-br.img.susercontent.com/file/${item.image}` : "",
    originalUrl: `https://shopee.com.br/${slug}-i.${item.shopid}.${item.itemid}`, vendas: item.historical_sold || item.sold || 0
  };
}

/**
 * A busca da Shopee só responde de dentro da página (cookies e cabeçalhos da
 * própria loja). O service worker injeta um script no mundo da página que faz a
 * chamada e devolve o resultado por postMessage com um bilhete.
 */
async function buscarPelaApi(): Promise<Produto[] | null> {
  const filter = filtroDaListagem();
  if (!filter) return null;
  const params = new URLSearchParams({ ...filter, limit: "60", newest: "0", order: "desc", page_type: "search", version: "2" });
  const url = `${location.origin}/api/v4/search/search_items?${params}`;
  const ticket = `dsp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  document.documentElement.setAttribute("data-dsp-pedido", JSON.stringify({ url, bilhete: ticket }));
  const answer = new Promise<any>(resolve => {
    const timer = setTimeout(() => { window.removeEventListener("message", listener); resolve(null); }, 8000);
    function listener(event: MessageEvent) {
      if (event.origin !== location.origin || event.data?.dsp !== ticket) return;
      clearTimeout(timer); window.removeEventListener("message", listener); resolve(event.data);
    }
    window.addEventListener("message", listener);
  });
  const injected = await chrome.runtime.sendMessage({ type: VITRINE_BUSCA_SHOPEE }).catch(() => null);
  if (!injected?.ok) return null;
  const result = await answer;
  const items: unknown[] = Array.isArray(result?.dados?.items) ? result.dados.items : [];
  const unique = new Map<string, Produto>();
  for (const entry of items) { const product = produtoDaApi(entry); if (product?.title && product.price && !unique.has(product.itemId)) unique.set(product.itemId, product); }
  return unique.size ? Array.from(unique.values()) : null;
}

/** Sem a API, rola a página até parar de aparecer card novo (a Shopee carrega conforme rola). */
async function rolarAteOFim() {
  const start = window.scrollY; let stale = 0; let best = cards().length;
  for (let round = 0; round < 60; round++) {
    const before = window.scrollY;
    window.scrollTo(0, before + Math.max(300, Math.floor(window.innerHeight * 0.85)));
    await new Promise(resolve => setTimeout(resolve, 260));
    const count = cards().length;
    if (count <= best && window.scrollY <= before) { if (++stale >= 3) break; } else stale = 0;
    best = Math.max(best, count);
  }
  window.scrollTo(0, start);
}

export const leitorShopee: LeitorDeLoja = {
  loja: "Shopee", cards, doCard, daPagina: () => ehPaginaDeProduto() ? daPagina() : null,
  async todosDaPagina() {
    const fromApi = await buscarPelaApi().catch(() => null);
    if (fromApi) return fromApi;
    await rolarAteOFim();
    const unique = new Map<string, Produto>();
    for (const card of cards()) { const product = doCard(card); if (product && !unique.has(product.itemId)) unique.set(product.itemId, product); }
    return Array.from(unique.values());
  }
};
