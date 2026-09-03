import { IMPORT_CATALOG, type CatalogProduct } from "./shared.js";

const money = (value?: string | null) => {
  if (!value) return undefined;
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : undefined;
};
const count = (value?: string | null) => { const match = value?.match(/[\d.,]+/); if (!match) return undefined; const suffix = value?.toLowerCase(); const parsed = Number(match[0].replace(/\./g, "").replace(",", ".")); return Number.isFinite(parsed) ? Math.round(parsed * (suffix?.includes("mil") ? 1000 : 1)) : undefined; };
const itemId = (url?: string | null) => url?.match(/\b(MLB[-_]?\d{6,})\b/i)?.[1].replace(/[-_]/g, "").toUpperCase();
const absolute = (url?: string | null) => { try { return url ? new URL(url, location.origin).href : undefined; } catch { return undefined; } };

function jsonLdProducts(): CatalogProduct[] {
  const output: CatalogProduct[] = [];
  for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'))) {
    try {
      const value = JSON.parse(script.textContent || "null"); const roots = Array.isArray(value) ? value : [value];
      const candidates = roots.flatMap(root => root?.itemListElement?.map((entry: any) => entry.item || entry) || [root]).filter((item: any) => item?.['@type'] === "Product");
      for (const product of candidates) {
        const url = absolute(product.url || product.offers?.url); const id = String(product.sku || product.productID || itemId(url) || "").trim();
        if (!id || !product.name) continue;
        output.push({ ml_item_id: id, product_name: String(product.name).trim(), image_url: absolute(Array.isArray(product.image) ? product.image[0] : product.image), price: money(String(product.offers?.price || "")), product_link: url, rating_star: money(String(product.aggregateRating?.ratingValue || "")), sales: count(String(product.aggregateRating?.reviewCount || "")), captured_at: new Date().toISOString() });
      }
    } catch { /* JSON-LD inválido não impede o fallback visual. */ }
  }
  return output;
}

function cardProducts(): CatalogProduct[] {
  const selectors = [".ui-search-layout__item", ".poly-card", "[data-testid='product-card']", "article"];
  const cards = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(",")));
  return cards.flatMap(card => {
    const link = card.querySelector<HTMLAnchorElement>('a[href*="MLB"],a[href*="/p/"]'); const url = absolute(link?.href); const id = itemId(url || card.textContent);
    const title = card.querySelector<HTMLElement>("h2,h3,.poly-component__title,.ui-search-item__title")?.textContent?.trim() || link?.getAttribute("title")?.trim();
    if (!id || !title) return [];
    const text = card.textContent || ""; const priceText = card.querySelector<HTMLElement>(".andes-money-amount__fraction,[itemprop='price']")?.textContent;
    const oldPriceText = card.querySelector<HTMLElement>("s,.andes-money-amount--previous")?.textContent;
    const discount = money(text.match(/(\d+(?:[,.]\d+)?)%\s*OFF/i)?.[1]);
    return [{ ml_item_id: id, product_name: title, image_url: absolute(card.querySelector<HTMLImageElement>("img")?.src), price: money(priceText), original_price: money(oldPriceText), discount_rate: discount, product_link: url, sales: count(text.match(/([\d.,]+\s*(?:mil\s*)?vendid[oa]s?)/i)?.[1]), rating_star: money(text.match(/\b([0-5][,.]\d)\b/)?.[1]), is_full: /\bFULL\b/i.test(text), free_shipping: /frete\s+gr[aá]tis/i.test(text), captured_at: new Date().toISOString() }];
  });
}

let lastSignature = "";
async function capture() {
  const products = [...jsonLdProducts(), ...cardProducts()]; const unique = [...new Map(products.map(product => [product.ml_item_id, product])).values()];
  const signature = unique.map(product => product.ml_item_id).sort().join(",");
  if (!unique.length || signature === lastSignature) return; lastSignature = signature;
  await chrome.runtime.sendMessage({ type: IMPORT_CATALOG, products: unique });
}

setTimeout(() => void capture(), 1500);
let timer: ReturnType<typeof setTimeout> | undefined;
new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => void capture(), 1200); }).observe(document.documentElement, { childList: true, subtree: true });
