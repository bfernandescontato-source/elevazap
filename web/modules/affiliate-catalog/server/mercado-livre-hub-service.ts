import { cookieHeader } from "@disparei/affiliate-links/mercado-livre-session";
import { decryptIntegrationSecret } from "@/lib/integration-crypto";
import { importMercadoLivreExtensionProducts } from "./mercado-livre-catalog-service";
import type { MercadoLivreExtensionProduct } from "../mercado-livre-import-schema";

// Central de afiliados do Mercado Livre: devolve produtos já com a comissão (GANHOS),
// como a API da Shopee. Chamado do servidor com a sessão guardada do afiliado (sem PC).
const HUB_URL = "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const component = (card: any, id: string) => (card?.components || []).find((c: any) => c?.id === id);

function parseCard(card: any): MercadoLivreExtensionProduct | null {
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
    captured_at: new Date().toISOString()
  };
}

export async function syncMercadoLivreHub(database: any, accountId: string) {
  const { data, error } = await database.from("affiliate_integrations").select("encrypted_session_cookies").eq("account_id", accountId).eq("provider", "mercado_livre").maybeSingle();
  if (error) throw error;
  if (!data?.encrypted_session_cookies) throw new Error("MERCADO_LIVRE_SESSION_MISSING");
  let cookies: Record<string, string>;
  try { cookies = JSON.parse(decryptIntegrationSecret(data.encrypted_session_cookies)); } catch { throw new Error("MERCADO_LIVRE_SESSION_MISSING"); }
  const header = cookieHeader(cookies);
  if (!header || !cookies.ssid) throw new Error("MERCADO_LIVRE_SESSION_MISSING");
  let response: Response;
  try {
    response = await fetch(HUB_URL, {
      method: "POST",
      headers: { cookie: header, "user-agent": UA, accept: "application/json", "content-type": "application/json", origin: "https://www.mercadolivre.com.br", referer: "https://www.mercadolivre.com.br/afiliados/hub" },
      body: "", signal: AbortSignal.timeout(12_000)
    });
  } catch { throw new Error("MERCADO_LIVRE_HUB_UNAVAILABLE"); }
  if (!response.ok) throw new Error("MERCADO_LIVRE_HUB_UNAVAILABLE");
  const json = await response.json().catch(() => null);
  const cards = json?.polycard_client_model?.polycards;
  if (!Array.isArray(cards)) throw new Error("MERCADO_LIVRE_HUB_UNAVAILABLE");
  const products = cards.map(parseCard).filter((p): p is MercadoLivreExtensionProduct => Boolean(p));
  if (!products.length) return { received: cards.length, inserted: 0, updated: 0, errors: 0 };
  return importMercadoLivreExtensionProducts(products, products.length, 0);
}
