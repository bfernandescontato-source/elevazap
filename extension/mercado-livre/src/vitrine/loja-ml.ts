import { dinheiro, ehPaginaDeProduto, fotoGrande, imagemDoCard, semRuido, soExternos, textOf, type LeitorDeLoja, type Produto } from "./lojas.js";

const idDoItem = (value?: string | null) => {
  const match = (value || "").match(/MLB(U)?[-\s]?(\d+)/i);
  return match ? `MLB${match[1] ? "U" : ""}${match[2]}` : null;
};
const PRECO = /R\$\s*(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{2})?/;
const VALOR_CUPOM = /R\$\s*(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(?:OFF|DESCONTO)?/i;
const PALAVRAS_QUE_NAO_SAO_CUPOM = /^(CUPOM|COUPON|OFF|DESCONTO|PROMO|GRATIS|FRETE|FULL|NOVO|NOVA|EXTRA|VER|TODOS|MAIS|AQUI|AGORA)$/i;
const RUIDO_DA_PDP = ["[class*=\"recommendations\"]", "[class*=\"carousel\"]", "[class*=\"-intervention\"]", "[class*=\"polycard\"]", "[class*=\"advertising\"]", "[class*=\"comments\"]", "[class*=\"reviews\"]", "[class*=\"questions\"]", "footer"].join(",");
const VITRINES = [".ui-recommendations-carousel-wrapper-ref", "[class*=\"recommendations-carousel\"]", "[class*=\"brand-wrapper-products-carousel\"]", "[class*=\"hero-v3\"]", "[class*=\"-intervention\"]"].join(", ");

function normalizarCupom(value?: string | null) {
  const money = (value || "").match(VALOR_CUPOM)?.[0];
  if (money) {
    const amount = dinheiro(money.replace(/\s*(OFF|DESCONTO)/i, ""));
    if (!Number.isFinite(amount) || amount < 5) return "";
    return money.replace(/\s+/g, " ").replace(/\s*(OFF|DESCONTO)$/i, " OFF").toUpperCase();
  }
  const percent = (value || "").match(/\d{1,3}\s*%\s*(?:OFF|DESCONTO)?/i)?.[0];
  if (percent) { const text = percent.replace(/\s+/g, " ").toUpperCase(); return /\bOFF\b/.test(text) ? text : `${text} OFF`; }
  const code = (value || "").match(/[A-Z][A-Z0-9_-]{2,24}/i)?.[0] || "";
  return !code || PALAVRAS_QUE_NAO_SAO_CUPOM.test(code) ? "" : code.toUpperCase();
}

function cupomDoTexto(element: Element, price: string) {
  const text = textOf(element);
  if (!text || !/(cupom|coupon|cupon|c[oó]digo)/i.test(text)) return "";
  const patterns = [/cupom[^\d$]{1,18}(R\$\s*(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(?:OFF|DESCONTO)?)/i, /cupom[^\dA-Z]{1,18}(\d{1,3}\s*%\s*(?:OFF|DESCONTO)?)/i, /(?:cupom|coupon|cupon|c[oó]digo)[^A-Z]{0,18}([A-Z][A-Z0-9_-]{2,24})/i];
  for (let index = 0; index < patterns.length; index++) {
    const found = text.match(patterns[index])?.[1];
    if (index === 2 && found && found !== found.toUpperCase()) continue; // código de cupom é sempre em maiúsculas
    const coupon = normalizarCupom(found);
    if (coupon) return coupon;
  }
  const withCoupon = text.match(/(R\$\s*(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?)\s*(?:com\s+cupom)/i)?.[1];
  if (withCoupon && price) {
    const off = dinheiro(price) - dinheiro(withCoupon);
    if (Number.isFinite(off) && off >= 5) return `R$ ${off.toFixed(2).replace(".", ",")} OFF`;
  }
  return "";
}

function cupom(root: Element, price: string) {
  for (const selector of ["[class*=\"coupon\"]", "[class*=\"cupom\"]", "[aria-label*=\"cupom\" i]", "[title*=\"cupom\" i]"]) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (textOf(element).length > 50) continue;
      const found = cupomDoTexto(element, price);
      if (found) return found;
    }
  }
  for (const element of Array.from(root.querySelectorAll("span, p, small, label, div"))) {
    const text = element.children.length === 0 ? (element.textContent || "").trim() : "";
    if (!text || !/(cupom|coupon)/i.test(text)) continue;
    const found = cupomDoTexto(element, price);
    if (found) return found;
  }
  return "";
}

function freteGratis(text: string, price?: string) {
  if (!/frete\s+gr[aá]tis/i.test(text)) return false;
  const minimum = text.match(/frete\s+gr[aá]tis\s+(?:acima|a\s+partir)\s+de\s+R\$\s*([\d.,]+)/i);
  if (!minimum) return true;
  const limit = dinheiro(minimum[1]); const value = dinheiro(price);
  return Number.isFinite(limit) && Number.isFinite(value) && value >= limit;
}

function selos(root: Element, title: string, price?: string) {
  const text = (root.textContent || "").replace(/\s+/g, " ");
  const withoutTitle = title ? text.split(title).join(" ") : text;
  const full = /\bFULL\b/.test(withoutTitle.replace(/full\s*(hd|size|frame|hd\+)/gi, " ")) || Boolean(root.querySelector("[aria-label*=\"full\" i], img[alt*=\"full\" i], [class*=\"fulfillment\" i]"));
  const sold = text.match(/\+?\s*([\d.]+)\s*(?:mil\s*)?vendid[oa]s?/i);
  let vendas = 0;
  if (sold) { vendas = parseInt(sold[1].replace(/\./g, ""), 10) || 0; if (/mil\s*vendid/i.test(sold[0])) vendas *= 1000; }
  return { freteGratis: freteGratis(text, price), mercadoFull: full, vendas };
}

function preco(card: Element, atual: boolean) {
  const amounts = Array.from(card.querySelectorAll(".andes-money-amount"));
  if (amounts.length) {
    const riscado = (element: Element) => Boolean(element.closest("s")) || /previous|anterior/i.test(element.className);
    const amount = amounts.find(element => atual ? !riscado(element) : riscado(element));
    const fraction = amount?.querySelector(".andes-money-amount__fraction")?.textContent;
    if (fraction) return `R$ ${fraction},${amount?.querySelector(".andes-money-amount__cents")?.textContent || "00"}`;
    if (atual) return "";
  }
  const struck = card.querySelector("s")?.textContent?.match(PRECO)?.[0];
  if (!atual) return struck || "";
  for (const element of Array.from(card.querySelectorAll("*"))) {
    if (element.children.length) continue;
    const text = (element.textContent || "").trim();
    if (!PRECO.test(text)) continue;
    if (element.closest("s") || /previous|anterior|old/i.test(element.closest("[class]")?.className || "")) continue;
    return text.match(PRECO)![0];
  }
  return "";
}

function maiorTexto(card: Element, price: string) {
  let longest = "";
  for (const element of Array.from(card.querySelectorAll("*"))) {
    if (element.children.length) continue;
    const text = textOf(element);
    if (text.length < 8 || text.length > 200 || text === price) continue;
    if (PRECO.test(text) || /^(OFF|FULL|frete gr[aá]tis|cupom|\+?\s*[\d.]+\s*vendid)/i.test(text)) continue;
    if (text.length > longest.length) longest = text;
  }
  return longest;
}

/** Link de anúncio patrocinado (click1/mclics) vira o link limpo do produto. */
function linkLimpo(href?: string | null) {
  if (!href) return "";
  if (!/click1\.mercadolivre|\/mclics\//i.test(href)) return href;
  const id = idDoItem(href);
  return id ? `https://produto.mercadolivre.com.br/${id.replace(/^MLB/, "MLB-")}` : "";
}

function doCard(card: Element): Produto | null {
  const links = [card.querySelector<HTMLAnchorElement>("a.poly-component__title"), card.querySelector<HTMLAnchorElement>("a.ui-search-link"), ...Array.from(card.querySelectorAll<HTMLAnchorElement>("a[href*=\"MLB\"]"))];
  let url = ""; let link: HTMLAnchorElement | null = null;
  for (const candidate of links) { const clean = linkLimpo(candidate?.href); if (clean) { url = clean; link = candidate; break; } }
  const itemId = idDoItem(url);
  if (!itemId || !url) return null;
  const price = preco(card, true); const oldPrice = preco(card, false);
  let title = card.querySelector(".poly-component__title")?.textContent?.trim() || card.querySelector(".ui-search-item__title")?.textContent?.trim() || link?.textContent?.trim() || "";
  if (!title) title = Array.from(card.querySelectorAll("a[href*=\"MLB\"]")).map(textOf).find(text => text.length > 3) || maiorTexto(card, price) || (imagemDoCard(card)?.getAttribute("alt") || "").trim();
  if (!title) return null;
  let discount = card.querySelector("[class*=\"discount\"], .andes-money-amount__discount")?.textContent?.match(/(\d+)%/)?.[1];
  if (!discount && price && oldPrice) { const now = dinheiro(price); const before = dinheiro(oldPrice); if (before > now) discount = String(Math.round((1 - now / before) * 100)); }
  const image = imagemDoCard(card);
  return {
    itemId, platform: "ML", title, price, oldPrice, discount: discount ? `${discount}%` : "",
    installment: (card.querySelector("[class*=\"installments\"], .poly-price__installments")?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
    coupon: cupom(card, price), imageUrl: fotoGrande(image?.getAttribute("data-src") || image?.src),
    ...selos(card, title), originalUrl: url.split("?")[0]
  };
}

function daPagina(): Produto | null {
  const itemId = idDoItem(location.href);
  if (!itemId) return null;
  const title = document.querySelector("h1.ui-pdp-title")?.textContent?.trim() || document.title.replace(/ \| Mercado Livre.*/, "").trim();
  const main = semRuido(document.querySelector("main") || document.body, RUIDO_DA_PDP);
  const amount = (element: Element | null) => element ? `R$ ${element.textContent},${element.parentElement?.querySelector(".andes-money-amount__cents")?.textContent || "00"}` : "";
  const price = amount(main.querySelector(".ui-pdp-price__second-line .andes-money-amount__fraction") || main.querySelector(".andes-money-amount__fraction"));
  return {
    itemId, platform: "ML", title, price,
    oldPrice: amount(main.querySelector("s .andes-money-amount__fraction, .ui-pdp-price__original-value .andes-money-amount__fraction")),
    discount: main.querySelector("[class*=\"discount\"]")?.textContent?.match(/(\d+)%/)?.[1]?.concat("%") || "",
    installment: (main.querySelector(".ui-pdp-price__subtitles, [class*=\"installment\"]")?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
    coupon: cupom(main, price),
    imageUrl: fotoGrande(document.querySelector<HTMLImageElement>(".ui-pdp-gallery__figure img")?.src || document.querySelector<HTMLMetaElement>("meta[property=\"og:image\"]")?.content),
    ...selos(main, title, price), originalUrl: location.href.split("?")[0]
  };
}

function cards() {
  const found = new Set<Element>();
  for (const selector of ["li.ui-search-layout__item", "div.poly-card", "div.ui-search-result__wrapper", "ol.ui-search-layout > li"]) {
    document.querySelectorAll(selector).forEach(card => { if (!card.closest(VITRINES)) found.add(card); });
  }
  return soExternos(found);
}

/** Cards fora do layout de busca (home, ofertas do dia): sobe do link MLB até o bloco que tem preço e um só produto. */
function cardsInferidos() {
  const found = new Set<Element>();
  document.querySelectorAll<HTMLAnchorElement>("a[href*=\"MLB\"]").forEach(anchor => {
    if (!/(MLB|MLBU)-?\d{8,14}/i.test(anchor.href) || anchor.closest(VITRINES)) return;
    let block: Element = anchor;
    for (let level = 0; level < 6 && block.parentElement; level++) {
      block = block.parentElement;
      if (!block.querySelector(".andes-money-amount") && !PRECO.test(block.textContent || "")) continue;
      const ids = new Set<string>();
      block.querySelectorAll<HTMLAnchorElement>("a[href*=\"MLB\"]").forEach(other => { const match = other.href.match(/(MLB|MLBU)-?(\d{8,14})/i); if (match) ids.add(`${match[1]}${match[2]}`.toUpperCase()); });
      if (ids.size === 1) found.add(block);
      break;
    }
  });
  return Array.from(found);
}

export const leitorML: LeitorDeLoja = {
  loja: "ML", cards, doCard, daPagina: () => ehPaginaDeProduto() ? daPagina() : null,
  async todosDaPagina() {
    const unique = new Map<string, Produto>();
    for (const card of new Set([...cards(), ...cardsInferidos()])) { const product = doCard(card); if (product && !unique.has(product.itemId)) unique.set(product.itemId, product); }
    return Array.from(unique.values());
  }
};
