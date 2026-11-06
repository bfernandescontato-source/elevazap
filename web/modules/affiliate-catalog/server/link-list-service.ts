import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { shopeeProductInfo } from "@/modules/piloto-link/server/service";
import { nameFromUrl, productIdFromUrl, STORE_LABEL, STORE_SHORT_HOSTS, storeOf, type ListStore } from "../link-list";
import type { AffiliateOffer } from "../types";
import { startMercadoLivreAffiliateLink } from "./mercado-livre-link-service";
import { resolveStoreShortLink, ShortLinkError } from "./store-short-link";
import { amazonAffiliateLink, magaluAffiliateLink, shopeeAffiliateLink, StoreLinkError } from "./store-link-service";

// Modo Lista: um link colado vira uma oferta com o link afiliado da conta.
// Usa os mesmos conversores do Catálogo; os dados do produto vêm da API da
// Shopee ou do catálogo já coletado (Mercado Livre, Amazon, Magalu).

export type ListLinkResult =
  | { input: string; status: "ready"; offer: AffiliateOffer; missingInfo: boolean }
  | { input: string; status: "pending"; offer: AffiliateOffer; missingInfo: boolean; jobId: string }
  | { input: string; status: "error"; store: ListStore | null; error: string };

class ListLinkError extends Error {}

const NOT_CONNECTED: Record<ListStore, string> = {
  SHOPEE: "Shopee não conectada. Conecte em Integrações.",
  MERCADO_LIVRE: "Mercado Livre não conectado. Conecte no Piloto Automático.",
  AMAZON: "Amazon não conectada. Coloque seu ID de Associado em Integrações.",
  MAGALU: "Magalu não conectada. Conecte sua loja em Integrações."
};
const NO_PRODUCT = "Não achamos o produto neste link. Abra o link e copie o endereço do produto.";

const positive = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; };

type Info = { name?: string; imageUrl?: string; priceMin?: number; originalPrice?: number; discountPercentage?: number };

/** Produto já coletado para o Catálogo (Amazon e Magalu pela extensão). Melhor esforço. */
async function storeCatalogInfo(provider: "AMAZON" | "MAGALU", externalItemId: string): Promise<Info | null> {
  const { data } = await supabaseAdmin().from("catalog_store_offers").select("name,image_url,price,original_price,discount_rate")
    .eq("provider", provider).eq("external_item_id", externalItemId).maybeSingle();
  if (!data) return null;
  return { name: data.name || undefined, imageUrl: data.image_url || undefined, priceMin: positive(data.price), originalPrice: positive(data.original_price), discountPercentage: positive(data.discount_rate) };
}

async function mercadoLivreInfo(itemId: string): Promise<Info | null> {
  const { data } = await supabaseAdmin().from("mercado_livre_products").select("product_name,image_url,price,original_price,discount_rate")
    .eq("ml_item_id", itemId).maybeSingle();
  if (!data) return null;
  return { name: data.product_name || undefined, imageUrl: data.image_url || undefined, priceMin: positive(data.price), originalPrice: positive(data.original_price), discountPercentage: positive(data.discount_rate) };
}

const quietly = <T>(promise: Promise<T>) => promise.catch(() => null);

function buildOffer(store: ListStore, externalItemId: string, productUrl: string, affiliateUrl: string | undefined, info: Info | null) {
  const name = info?.name?.trim() || nameFromUrl(store, productUrl) || `Produto ${STORE_LABEL[store]}`;
  const offer: AffiliateOffer = { provider: store, externalItemId, name: name.slice(0, 500), productUrl, affiliateUrl };
  if (info?.imageUrl && /^https:\/\//i.test(info.imageUrl)) offer.imageUrl = info.imageUrl;
  if (info?.priceMin) offer.priceMin = info.priceMin;
  if (info?.originalPrice) offer.originalPrice = info.originalPrice;
  if (info?.discountPercentage && info.discountPercentage <= 100) offer.discountPercentage = info.discountPercentage;
  return { offer, missingInfo: !info?.name || !info.priceMin };
}

/** Endereço limpo do produto: sem rastreio nem a marca de afiliado de outra pessoa. */
async function productUrlFor(store: ListStore, input: string, fetcher?: typeof fetch) {
  const url = STORE_SHORT_HOSTS.has(new URL(input).hostname.toLowerCase()) ? await resolveStoreShortLink(input, store, { fetcher }) : new URL(input);
  url.hash = "";
  // Amazon: o conversor do Catálogo já abre os links curtos; o código (ASIN) sai do link convertido.
  if (store === "AMAZON") return { id: "", url: input, slugUrl: url.toString() };
  const id = productIdFromUrl(store, url);
  if (!id) throw new ListLinkError(NO_PRODUCT);
  if (store === "SHOPEE") {
    const shop = url.pathname.match(/-i\.(\d+)\.\d+/)?.[1] ?? url.pathname.match(/\/product\/(\d+)\/\d+/)?.[1] ?? url.pathname.match(/^\/[^/]+\/(\d+)\/\d+\/?$/)?.[1];
    return { id, url: shop ? `https://shopee.com.br/product/${shop}/${id}` : `https://shopee.com.br${url.pathname}`, slugUrl: url.toString() };
  }
  if (store === "MAGALU") {
    // Link da Magazine Luiza vira o da Magazine Você; a loja da conta entra no lugar da primeira parte.
    if (/magazineluiza\.com\.br$/i.test(url.hostname)) {
      const slug = url.pathname.match(/^\/([^/]+)\/p\//)?.[1];
      return { id, url: `https://www.magazinevoce.com.br/magazinevoce/${slug ? `${slug}/` : ""}p/${id}/`, slugUrl: url.toString() };
    }
    return { id, url: `https://www.magazinevoce.com.br${url.pathname}`, slugUrl: url.toString() };
  }
  if (store === "MERCADO_LIVRE") {
    for (const key of [...url.searchParams.keys()]) if (key !== "pdp_filters") url.searchParams.delete(key);
  }
  return { id, url: url.toString(), slugUrl: url.toString() };
}

function storeErrorMessage(store: ListStore, error: unknown) {
  if (error instanceof ListLinkError || error instanceof ShortLinkError) return error.message;
  if (error instanceof StoreLinkError) return error.status === 409 ? NOT_CONNECTED[store] : error.message;
  const code = error instanceof Error ? error.message : "";
  if (code === "MERCADO_LIVRE_EXTENSION_NOT_CONNECTED") return NOT_CONNECTED.MERCADO_LIVRE;
  if (code === "MERCADO_LIVRE_INVALID_URL") return NO_PRODUCT;
  return `A ${STORE_LABEL[store]} não gerou o link afiliado agora. Tente de novo.`;
}

export async function resolveListLink(database: SupabaseClient, accountId: string, rawInput: string, deps: { fetcher?: typeof fetch } = {}): Promise<ListLinkResult> {
  const input = rawInput.trim().replace(/^http:\/\//i, "https://");
  const store = storeOf(input);
  if (!store) return { input, status: "error", store: null, error: "Link não reconhecido. Use Shopee, Mercado Livre, Amazon ou Magalu." };
  try {
    const product = await productUrlFor(store, input, deps.fetcher);
    if (store === "SHOPEE") {
      const [affiliateUrl, info] = await Promise.all([
        shopeeAffiliateLink(database, accountId, product.url),
        quietly(shopeeProductInfo(database, accountId, product.url))
      ]);
      const built = buildOffer(store, product.id, product.slugUrl, affiliateUrl, info ? { name: info.productName, imageUrl: info.imageUrl ?? undefined, priceMin: positive(info.price) } : null);
      return { input, status: "ready", ...built, offer: { ...built.offer, productUrl: product.url } };
    }
    if (store === "AMAZON") {
      const affiliateUrl = await amazonAffiliateLink(database, accountId, product.url);
      const asin = productIdFromUrl("AMAZON", affiliateUrl);
      if (!asin) throw new ListLinkError(NO_PRODUCT);
      const built = buildOffer(store, asin, product.slugUrl, affiliateUrl, await quietly(storeCatalogInfo("AMAZON", asin)));
      return { input, status: "ready", ...built };
    }
    if (store === "MAGALU") {
      const [affiliateUrl, info] = await Promise.all([magaluAffiliateLink(database, accountId, product.url), quietly(storeCatalogInfo("MAGALU", product.id))]);
      const built = buildOffer(store, product.id, product.slugUrl, affiliateUrl, info);
      return { input, status: "ready", ...built };
    }
    const [link, info] = await Promise.all([startMercadoLivreAffiliateLink(database, accountId, product.url, product.id), quietly(mercadoLivreInfo(product.id))]);
    const built = buildOffer(store, product.id, product.url, link.status === "completed" ? link.affiliateUrl : undefined, info);
    if (link.status === "pending") return { input, status: "pending", ...built, jobId: link.jobId };
    return { input, status: "ready", ...built };
  } catch (error) {
    const known = error instanceof ListLinkError || error instanceof ShortLinkError || error instanceof StoreLinkError || (error instanceof Error && /^MERCADO_LIVRE_/.test(error.message));
    if (!known) console.error({ event: "catalog_link_list_failed", component: "affiliate-catalog", account_id: accountId, provider: store, error: error instanceof Error ? error.message : String(error) });
    return { input, status: "error", store, error: storeErrorMessage(store, error) };
  }
}
