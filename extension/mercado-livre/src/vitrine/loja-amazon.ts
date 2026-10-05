import { ehPaginaDeProduto, fotoGrande, precoBR, soExternos, textOf, type LeitorDeLoja, type Produto } from "./lojas.js";

const asinDaUrl = (value?: string | null) => (value || "").match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] ?? null;

function precoEmPartes(whole?: string | null, fraction?: string | null) {
  const integer = String(whole || "").trim().replace(/[.,]\s*$/, "");
  return integer ? precoBR(`R$ ${integer},${String(fraction || "00").trim() || "00"}`) : "";
}

function maiorTexto(card: Element) {
  let longest = "";
  for (const element of Array.from(card.querySelectorAll("*"))) {
    if (element.children.length) continue;
    const text = textOf(element);
    if (text.length < 8 || text.length > 200) continue;
    if (/^R\$|%\s*(off|desconto)|estrela|avalia[cç][aã]o|parcela|frete|entrega|patrocinado|anúncio/i.test(text)) continue;
    if (text.length > longest.length) longest = text;
  }
  return longest;
}

function cards() {
  const found = new Set<Element>();
  document.querySelectorAll("[data-asin][data-component-type=\"s-search-result\"]").forEach(card => { if (card.getAttribute("data-asin")) found.add(card); });
  if (!found.size) document.querySelectorAll(".s-result-item[data-asin]").forEach(card => { if (card.getAttribute("data-asin")?.length === 10) found.add(card); });
  if (!found.size) document.querySelectorAll("div[id]").forEach(card => { if (/^[A-Z0-9]{10}$/.test(card.id) && card.querySelector("a[href*=\"/dp/\"]")) found.add(card); });
  if (!found.size) document.querySelectorAll("[data-testid=\"product-card\"][data-asin]").forEach(card => found.add(card));
  if (!found.size) document.querySelectorAll("li.octopus-pc-item, .dcl-product").forEach(card => found.add(card));
  if (!found.size) {
    // Página sem layout conhecido (ofertas, vitrines): sobe do link /dp/ até um bloco com cara de card.
    document.querySelectorAll("a[href*=\"/dp/\"], a[href*=\"/gp/product/\"]").forEach(anchor => {
      let block: Element | null = anchor;
      for (let level = 0; level < 6 && block && block !== document.body; level++) {
        block = block.parentElement;
        if (!block) break;
        const box = block.getBoundingClientRect();
        if (box.width >= 120 && box.width < 500 && box.height >= 100) { found.add(block); break; }
      }
    });
  }
  return soExternos(found);
}

function doCard(card: Element): Produto | null {
  const asin = card.getAttribute("data-asin") || (/^[A-Z0-9]{10}$/.test(card.id) ? card.id : null) || asinDaUrl(card.querySelector<HTMLAnchorElement>("a[href*=\"/dp/\"], a[href*=\"/gp/product\"]")?.href);
  if (!asin || asin.length !== 10) return null;
  const heading = card.querySelector("h2");
  const title = (heading?.getAttribute("aria-label")
    || textOf(card.querySelector("h2 a span, h2 span.a-text-normal, h2 .a-size-medium, h2 .a-size-base, [class*=\"p13n-sc-css-line-clamp\"], [class*=\"ProductCard-module__title\"] .a-truncate-full.a-offscreen, [class*=\"dcl-product-label\"]"))
    || textOf(heading) || card.querySelector("a[title]")?.getAttribute("title") || maiorTexto(card)).replace(/^An[uú]ncio patrocinado\s*[–-]\s*/i, "");
  if (!title) return null;
  let price = "";
  for (const element of Array.from(card.querySelectorAll(".a-price"))) {
    if (element.closest("del") || element.closest("[class*=\"strike\"]") || element.matches("[data-a-strike=\"true\"]")) continue;
    const offscreen = element.querySelector(".a-offscreen");
    if (offscreen) { price = precoBR(offscreen.textContent); break; }
  }
  if (!price) { const whole = card.querySelector(".a-price-whole"); if (whole) price = precoEmPartes(whole.textContent, card.querySelector(".a-price-fraction")?.textContent); }
  if (!price) price = precoBR(card.querySelector("[class*=\"p13n-sc-price-animation-wrapper\"], [class*=\"p13n-sc-price\"]")?.textContent);
  const discount = textOf(card.querySelector("[class*=\"savingsPercentage\"], [class*=\"savings-percent\"], [class*=\"badgeLabel\"], .a-color-success")).match(/(\d+)%/)?.[1];
  const image = card.querySelector<HTMLImageElement>("img.s-image, img[data-image-index], img.p13n-product-image") || card.querySelector<HTMLImageElement>("img[src*=\"m.media-amazon.com/images/\"]");
  return {
    itemId: asin, platform: "Amazon", title, price,
    oldPrice: precoBR(card.querySelector("del .a-offscreen, .a-text-strike .a-offscreen, del .a-price-whole, [data-a-strike=\"true\"] .a-offscreen")?.textContent),
    discount: discount ? `${discount}%` : "", coupon: "",
    installment: textOf(card.querySelector("[class*=\"installment\"], [class*=\"parcelamento\"]")).slice(0, 120),
    imageUrl: fotoGrande(image?.src), originalUrl: `https://${location.hostname}/dp/${asin}`
  };
}

function daPagina(): Produto | null {
  const asin = asinDaUrl(location.pathname) || document.querySelector<HTMLInputElement>("#ASIN, input[name=\"ASIN\"]")?.value;
  if (!asin) return null;
  const toPay = document.querySelector(".priceToPay .a-offscreen") || document.querySelector("#priceblock_ourprice, #priceblock_dealprice, #price_inside_buybox");
  const price = precoBR(toPay?.textContent || textOf(toPay)) || precoBR(textOf(document.querySelector(".priceToPay")));
  const discount = textOf(document.querySelector("#savingsPercentage, .savingsPercentage, [id*=\"saving\"]")).match(/(\d+)%/)?.[1];
  const image = document.querySelector<HTMLImageElement>("#landingImage")?.src || document.querySelector<HTMLImageElement>("#imgBlkFront")?.src
    || document.querySelector<HTMLMetaElement>("meta[property=\"og:image\"]")?.content || document.querySelector<HTMLImageElement>("#main-image-container img[src*=\"m.media-amazon.com/images/\"]")?.src;
  return {
    itemId: asin, platform: "Amazon",
    title: textOf(document.getElementById("productTitle")) || document.title.replace(/[\s:]+Amazon.*/, "").trim(),
    price, oldPrice: precoBR(document.querySelector(".basisPrice .a-offscreen, #listPrice, .a-text-strike .a-offscreen")?.textContent),
    discount: discount ? `${discount}%` : "", coupon: "",
    installment: textOf(document.querySelector("#installmentCalculatorRow, [class*=\"installment\"]")).slice(0, 120),
    imageUrl: fotoGrande(image), originalUrl: `https://${location.hostname}/dp/${asin}`
  };
}

export const leitorAmazon: LeitorDeLoja = {
  loja: "Amazon", cards, doCard, daPagina: () => ehPaginaDeProduto() ? daPagina() : null,
  async todosDaPagina() {
    const unique = new Map<string, Produto>();
    for (const card of cards()) { const product = doCard(card); if (product && !unique.has(product.itemId)) unique.set(product.itemId, product); }
    return Array.from(unique.values());
  }
};
