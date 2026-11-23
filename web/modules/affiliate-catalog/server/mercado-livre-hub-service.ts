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

async function fetchHub(header: string, categoryId?: string, offset?: number): Promise<{ cards: any[]; categorias: Array<{ id: string; name: string }>; nextOffset?: number }> {
  // Página seguinte: a API aceita { offset } no corpo (devolve next_offset).
  const payload: Record<string, unknown> = {};
  if (categoryId) payload.filters = [{ id: "category", value: categoryId }];
  if (offset) payload.offset = offset;
  const body = Object.keys(payload).length ? JSON.stringify(payload) : "";
  let response: Response;
  try {
    response = await fetch(HUB_URL, {
      method: "POST",
      headers: { cookie: header, "user-agent": UA, accept: "application/json", "content-type": "application/json", origin: "https://www.mercadolivre.com.br", referer: "https://www.mercadolivre.com.br/afiliados/hub" },
      body, signal: AbortSignal.timeout(10_000)
    });
  } catch { throw new Error("MERCADO_LIVRE_HUB_UNAVAILABLE"); }
  if (response.status === 401 || response.status === 403) throw new Error("MERCADO_LIVRE_SESSION_EXPIRED");
  if (!response.ok) throw new Error("MERCADO_LIVRE_HUB_UNAVAILABLE");
  const json = await response.json().catch(() => null);
  const cards = json?.polycard_client_model?.polycards;
  if (!Array.isArray(cards)) throw new Error("MERCADO_LIVRE_HUB_UNAVAILABLE");
  const categoryFilter = (json?.filters || []).find((f: any) => f?.id === "category");
  const categorias = Array.isArray(categoryFilter?.values) ? categoryFilter.values.map((v: any) => ({ id: String(v.id), name: String(v.name) })) : [];
  const nextOffset = typeof json?.next_offset === "number" && json.next_offset > (offset || 0) ? json.next_offset : undefined;
  return { cards, categorias, nextOffset };
}

const hasCommission = (card: any) => Boolean(component(card, "affiliates_commission_chip"));
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const IMPORT_CHUNK = 400;

/** pagesPerCategory = 1 é a coleta leve da extensão de cada aluno (como antes).
 *  A rotina do servidor usa mais páginas por categoria, com pausa entre as
 *  chamadas para não irritar o Mercado Livre. */
export async function syncMercadoLivreHub(database: any, accountId: string, options: { pagesPerCategory?: number; delayMs?: number } = {}) {
  const pages = Math.min(Math.max(1, Math.trunc(options.pagesPerCategory || 1)), 6);
  const delayMs = Math.max(0, options.delayMs ?? 0);
  const { data, error } = await database.from("affiliate_integrations").select("encrypted_session_cookies").eq("account_id", accountId).eq("provider", "mercado_livre").maybeSingle();
  if (error) throw error;
  if (!data?.encrypted_session_cookies) throw new Error("MERCADO_LIVRE_SESSION_MISSING");
  let cookies: Record<string, string>;
  try { cookies = JSON.parse(decryptIntegrationSecret(data.encrypted_session_cookies)); } catch { throw new Error("MERCADO_LIVRE_SESSION_MISSING"); }
  const header = cookieHeader(cookies);
  if (!header || !cookies.ssid) throw new Error("MERCADO_LIVRE_SESSION_MISSING");

  // 1ª chamada: produtos em destaque + a lista de categorias.
  const base = await fetchHub(header);
  // Sem nenhuma comissão nos cards = a central respondeu como visitante (sessão vencida).
  if (pages > 1 && base.cards.length && !base.cards.some(hasCommission)) throw new Error("MERCADO_LIVRE_SESSION_EXPIRED");
  const unique = new Map<string, MercadoLivreExtensionProduct>();
  for (const card of base.cards) { const p = parseCard(card); if (p) unique.set(p.ml_item_id, p); }
  let calls = 1;

  // Categoria por categoria (sequencial), até `pages` páginas cada.
  for (const categoria of base.categorias.slice(0, MAX_CATEGORIAS)) {
    let offset: number | undefined;
    for (let page = 0; page < pages; page++) {
      if (delayMs) await pause(delayMs);
      try {
        const { cards, nextOffset } = await fetchHub(header, categoria.id, offset);
        calls++;
        let added = 0;
        for (const card of cards) { const p = parseCard(card, categoria.name, categoria.id); if (p && !unique.has(p.ml_item_id)) { unique.set(p.ml_item_id, p); added++; } }
        if (!nextOffset || !cards.length || (page > 0 && !added)) break;
        offset = nextOffset;
      } catch (error) {
        if (error instanceof Error && error.message === "MERCADO_LIVRE_SESSION_EXPIRED") throw error;
        break; /* uma categoria que falhou não derruba o resto */
      }
    }
  }

  const products = [...unique.values()];
  if (!products.length) return { received: 0, inserted: 0, updated: 0, errors: 0, categorias: base.categorias.length, chamadas: calls };
  const total = { received: 0, inserted: 0, updated: 0, errors: 0 };
  for (let index = 0; index < products.length; index += IMPORT_CHUNK) {
    const chunk = products.slice(index, index + IMPORT_CHUNK);
    const result = await importMercadoLivreExtensionProducts(chunk, chunk.length, 0);
    total.received += result.received; total.inserted += result.inserted; total.updated += result.updated; total.errors += result.errors;
  }
  return { ...total, categorias: base.categorias.length, chamadas: calls };
}
