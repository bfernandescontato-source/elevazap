import { ehPaginaDeProduto, fotoGrande, imagemDoCard, precoBR, semRuido, soExternos, textOf, type LeitorDeLoja, type Produto } from "./lojas.js";

const idDoProduto = (value?: string | null) => (value || "").match(/\/p\/([a-z0-9]{6,})(?:[/?]|$)/i)?.[1]?.toLowerCase() ?? null;
const TITULOS = ["[data-testid=\"product-card-title\"]", "[data-testid=\"product-title\"]", "h2", "h3", "[class*=\"title\"]"];
const FORA_DO_PRECO = ["[data-testid^=\"loyalty\"]", "[data-testid^=\"dialog\"]", "[class*=\"loyalty\"]", "[data-testid=\"product-card-price-installment\"]", ".dsp-card-btns"].join(",");
const PRECOS = ["[data-testid=\"price-value\"]", "[data-testid=\"product-card-price-final\"]", "[class*=\"price-value\"]"];
const RUIDO_DA_PDP = ["[class*=\"recommend\" i]", "[data-testid*=\"recommend\" i]", "[class*=\"carousel\" i]", "[data-testid*=\"carousel\" i]", "[class*=\"showcase\" i]", "[data-testid*=\"showcase\" i]", "footer"].join(",");

/** O bloco de parcelas da Magalu junta Pix, preço e parcelas; fica só "10x de R$ 25,90 sem juros". */
const parcelamento = (text: string) => text.match(/\d+x de R\$\s*[\d.,]+(?:\s*sem juros)?/i)?.[0] || "";
const tituloRuim = (text: string) => !text || text.length < 12 || /^(comiss[ãa]o|cupom|frete|desconto|oferta|patrocinado|novo)\b/i.test(text);

function titulo(card: Element, link: Element | null) {
  for (const selector of TITULOS) for (const element of Array.from(card.querySelectorAll(selector))) { const text = textOf(element); if (!tituloRuim(text)) return text; }
  const attribute = (link?.getAttribute("title") || link?.getAttribute("aria-label") || "").trim();
  return tituloRuim(attribute) ? "" : attribute;
}

function preco(card: Element) {
  for (const selector of PRECOS) for (const element of Array.from(card.querySelectorAll(selector))) {
    if (element.closest(FORA_DO_PRECO)) continue;
    const value = precoBR(textOf(element));
    if (value) return value;
  }
  return precoBR(textOf(semRuido(card, FORA_DO_PRECO)));
}

function cards() {
  const found = new Set<Element>();
  document.querySelectorAll("[data-testid=\"product-card\"], [data-testid=\"product-card-container\"], li[data-testid=\"product-card\"]").forEach(card => found.add(card));
  if (!found.size) {
    document.querySelectorAll<HTMLAnchorElement>("a[href*=\"/p/\"]").forEach(anchor => {
      if (!idDoProduto(anchor.href)) return;
      let block: Element | null = anchor;
      for (let level = 0; level < 7 && block && block !== document.body; level++) {
        if (block.tagName === "LI") { found.add(block); break; }
        if (block.querySelector("img")) { const box = block.getBoundingClientRect(); if (box.width >= 120 && box.height >= 140) { found.add(block); break; } }
        block = block.parentElement;
      }
    });
  }
  return soExternos(Array.from(found).filter(card => !card.closest("header") && !card.closest("footer") && !card.closest("nav")));
}

function doCard(card: Element): Produto | null {
  const link = card.tagName === "A" ? card as HTMLAnchorElement : card.querySelector<HTMLAnchorElement>("a[href*=\"/p/\"]");
  const url = (link?.href || "").split("?")[0];
  const itemId = idDoProduto(url);
  if (!itemId || !url) return null;
  const title = titulo(card, link);
  if (!title) return null;
  let oldPrice = "";
  for (const selector of ["[data-testid=\"price-original\"]", "[class*=\"before\"]", "[class*=\"oldPrice\"]", "[class*=\"old-price\"]", "s", "del", "[class*=\"from\"]"]) {
    const element = Array.from(card.querySelectorAll(selector)).find(candidate => !candidate.closest(FORA_DO_PRECO));
    if (element && (oldPrice = precoBR(textOf(element)))) break;
  }
  const discount = textOf(card.querySelector("[class*=\"discount\"], [class*=\"Discount\"], [class*=\"percent\"], [class*=\"off\"]")).match(/(\d+)\s*%/)?.[1];
  const image = imagemDoCard(card);
  return {
    itemId, platform: "Magalu", title, price: preco(card), oldPrice, discount: discount ? `${discount}%` : "", coupon: "",
    installment: parcelamento(textOf(card.querySelector("[class*=\"installment\"], [class*=\"parcel\"], [data-testid=\"installment\"]"))),
    imageUrl: fotoGrande(image?.getAttribute("data-src") || image?.getAttribute("src")), originalUrl: url
  };
}

function daPagina(): Produto | null {
  const itemId = idDoProduto(location.href);
  if (!itemId) return null;
  const body = semRuido(document.body, RUIDO_DA_PDP);
  const discount = textOf(body.querySelector("[data-testid=\"discount-percent\"], [class*=\"discount-percent\"]")).match(/(\d+)\s*%/)?.[1];
  return {
    itemId, platform: "Magalu",
    title: textOf(document.querySelector("h1")) || document.title.replace(/\s*[-|]\s*Magazine.*/, "").trim(),
    price: precoBR(textOf(body.querySelector("[data-testid=\"price-value\"]") || body.querySelector("[class*=\"price-value\"]"))),
    oldPrice: precoBR(textOf(body.querySelector("[data-testid=\"price-original\"], [class*=\"before-price\"], s, del"))),
    discount: discount ? `${discount}%` : "", coupon: "", installment: "",
    imageUrl: fotoGrande(document.querySelector<HTMLMetaElement>("meta[property=\"og:image\"]")?.content || document.querySelector<HTMLImageElement>("picture img, [data-testid=\"product-media\"] img")?.src),
    originalUrl: location.href.split("?")[0]
  };
}

export const leitorMagalu: LeitorDeLoja = {
  loja: "Magalu", cards, doCard, daPagina: () => ehPaginaDeProduto() ? daPagina() : null,
  async todosDaPagina() {
    const unique = new Map<string, Produto>();
    for (const card of cards()) { const product = doCard(card); if (product && !unique.has(product.itemId)) unique.set(product.itemId, product); }
    return Array.from(unique.values());
  }
};
