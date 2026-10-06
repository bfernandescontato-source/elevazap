import { cookieHeader } from "@disparei/affiliate-links/mercado-livre-session";
import { decryptIntegrationSecret } from "@/lib/integration-crypto";
import { importMercadoLivreExtensionProducts } from "./mercado-livre-catalog-service";
import type { MercadoLivreExtensionProduct } from "../mercado-livre-import-schema";

// Central de afiliados do Mercado Livre: devolve produtos já com a comissão (GANHOS),
// como a API da Shopee. Chamado do servidor com a sessão guardada (sem PC). Cada
// chamada traz ~17 produtos; para ter volume e categorias, puxamos categoria por
// categoria (a própria API traz a lista de categorias e filtra por ela).
const HUB_URL = "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAX_CATEGORIAS = 30;

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const component = (card: any, id: string) => (card?.components || []).find((c: any) => c?.id === id);

function parseCard(card: any, categoryName?: string, categoryId?: string): MercadoLivreExtensionProduct | null {
  const id = card?.metadata?.id;
  const title = component(card, "title")?.title?.text;
  if (!id || !title) return null;
  const price = component(card, "price")?.price;
  const chip = component(card, "affiliates_commission_chip")?.chip;
  const chipText: string = chip?.pill?.text || chip?.label?.text || "";
  const commission = chipText.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const current = num(price?.current_price?.value);
  const previous = num(price?.previous_price?.value);
  const discount = String(price?.discount_label?.text || "").match(/(\d+)/)?.[1];
  const picId = card?.pictures?.pictures?.[0]?.id;
  const url: string = card?.metadata?.url || "";
  return {
    ml_item_id: String(id),
    product_name: String(title).trim().slice(0, 500),
    image_url: picId ? `https://http2.mlstatic.com/D_NQ_NP_2X_${picId}-O.webp` : undefined,
    price: current,
    original_price: previous && current && previous > current ? previous : undefined,
    discount_rate: discount ? Number(discount) : undefined,
    commission_rate: commission ? Number(commission[1].replace(",", ".")) : undefined,
    product_link: url ? (url.startsWith("http") ? url : `https://${url}`) : undefined,
    badges: chipText ? [chipText] : undefined,
    extra_earnings: card?.metadata?.extra_commission === "true" ? true : undefined,
    category: categoryName,
    ml_category: categoryId,
    captured_at: new Date().toISOString()
  };
}

async function fetchHub(header: string, categoryId?: string): Promise<{ cards: any[]; categorias: Array<{ id: string; name: string }> }> {
  const body = categoryId ? JSON.stringify({ filters: [{ id: "category", value: categoryId }] }) : "";
  let response: Response;
  try {
    response = await fetch(HUB_URL, {
      method: "POST",
      headers: { cookie: header, "user-agent": UA, accept: "application/json", "content-type": "application/json", origin: "https://www.mercadolivre.com.br", referer: "https://www.mercadolivre.com.br/afiliados/hub" },
      body, signal: AbortSignal.timeout(10_000)
    });
  } catch { throw new Error("MERCADO_LIVRE_HUB_UNAVAILABLE"); }
  if (!response.ok) throw new Error("MERCADO_LIVRE_HUB_UNAVAILABLE");
  const json = await response.json().catch(() => null);
  const cards = json?.polycard_client_model?.polycards;
  if (!Array.isArray(cards)) throw new Error("MERCADO_LIVRE_HUB_UNAVAILABLE");
  const categoryFilter = (json?.filters || []).find((f: any) => f?.id === "category");
  const categorias = Array.isArray(categoryFilter?.values) ? categoryFilter.values.map((v: any) => ({ id: String(v.id), name: String(v.name) })) : [];
  return { cards, categorias };
}

export async function syncMercadoLivreHub(database: any, accountId: string) {
  const { data, error } = await database.from("affiliate_integrations").select("encrypted_session_cookies").eq("account_id", accountId).eq("provider", "mercado_livre").maybeSingle();
  if (error) throw error;
  if (!data?.encrypted_session_cookies) throw new Error("MERCADO_LIVRE_SESSION_MISSING");
  let cookies: Record<string, string>;
  try { cookies = JSON.parse(decryptIntegrationSecret(data.encrypted_session_cookies)); } catch { throw new Error("MERCADO_LIVRE_SESSION_MISSING"); }
  const header = cookieHeader(cookies);
  if (!header || !cookies.ssid) throw new Error("MERCADO_LIVRE_SESSION_MISSING");

  // 1ª chamada: produtos em destaque + a lista de categorias.
  const base = await fetchHub(header);
  const unique = new Map<string, MercadoLivreExtensionProduct>();
  for (const card of base.cards) { const p = parseCard(card); if (p) unique.set(p.ml_item_id, p); }

  // Uma chamada por categoria (sequencial, para não irritar o Mercado Livre).
  for (const categoria of base.categorias.slice(0, MAX_CATEGORIAS)) {
    try {
      const { cards } = await fetchHub(header, categoria.id);
      for (const card of cards) { const p = parseCard(card, categoria.name, categoria.id); if (p && !unique.has(p.ml_item_id)) unique.set(p.ml_item_id, p); }
    } catch { /* uma categoria que falhou não derruba o resto */ }
  }

  const products = [...unique.values()];
  if (!products.length) return { received: 0, inserted: 0, updated: 0, errors: 0, categorias: base.categorias.length };
  const result = await importMercadoLivreExtensionProducts(products, products.length, 0);
  return { ...result, categorias: base.categorias.length };
}
