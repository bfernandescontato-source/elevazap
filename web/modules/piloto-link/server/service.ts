import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptIntegrationSecret } from "@/lib/integration-crypto";
import { getAmazonIntegration, getShopeeIntegration, getShopeeIntegrationCredentials } from "@/modules/integrations/server/service";
import { shopeeGraphQl } from "@/modules/offer-autopilot/server/shopee-client";
import { amazonAffiliateLink, shopeeAffiliateLink, StoreLinkError } from "@/modules/affiliate-catalog/server/store-link-service";
import { buildCatalogOfferMessage, catalogMessageRandom } from "@/modules/affiliate-catalog/offer-message";
import { brasiliaDate } from "@/modules/affiliate-catalog/schedule-plan";
import { CatalogDispatchError, createCatalogDispatch, resolveCatalogTarget } from "@/modules/affiliate-catalog/server/catalog-dispatch-service";
import type { AffiliateOffer } from "@/modules/affiliate-catalog/types";

// Piloto Automático (Comentei + Disparei vendidos juntos): o app da Comentei pede aqui o link de
// afiliado da aluna. As credenciais de afiliado ficam só no Disparei; sai daqui apenas o link pronto.

export class PilotoLinkError extends Error {
  constructor(readonly code: "no_account" | "not_connected" | "unsupported" | "invalid_url" | "provider", message: string, readonly status: number) {
    super(message);
  }
}

export type Marketplace = "shopee" | "amazon";

export function marketplaceOf(url: URL): Marketplace | null {
  const host = url.hostname.toLowerCase();
  if (/(^|\.)shopee\.com\.br$/.test(host) || host === "shp.ee") return "shopee";
  if (/(^|\.)amazon\.com\.br$/.test(host) || host === "amzn.to" || host === "a.co") return "amazon";
  return null;
}

const SHORT_HOSTS = new Set(["s.shopee.com.br", "shp.ee", "amzn.to", "a.co"]);

/**
 * Link curto (de outra pessoa) -> endereço do produto, sem os parâmetros de afiliado dela.
 * Segue no máximo 5 redirecionamentos, só dentro dos domínios das lojas.
 */
export async function resolveProductUrl(raw: string, fetcher: typeof fetch = fetch) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new PilotoLinkError("invalid_url", "Link inválido.", 400); }
  for (let hop = 0; hop < 5 && SHORT_HOSTS.has(url.hostname.toLowerCase()); hop += 1) {
    const response = await fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8_000) });
    const location = response.headers.get("location");
    if (!location) break;
    const next = new URL(location, url);
    if (!marketplaceOf(next)) throw new PilotoLinkError("unsupported", "O link não leva a um produto de loja conhecida.", 422);
    url = next;
  }
  const marketplace = marketplaceOf(url);
  if (!marketplace) throw new PilotoLinkError("unsupported", "Loja ainda não suportada no Piloto.", 422);
  if (SHORT_HOSTS.has(url.hostname.toLowerCase())) throw new PilotoLinkError("provider", "Não foi possível abrir o link curto.", 502);
  return { marketplace, url: `${url.origin}${url.pathname}` };
}

/** Código do produto na Shopee: /loja/123/456 ou nome-i.123.456 */
export function shopeeItemId(productUrl: string) {
  const path = new URL(productUrl).pathname;
  return path.match(/-i\.\d+\.(\d+)/)?.[1] ?? path.match(/^\/[^/]+\/\d+\/(\d+)/)?.[1] ?? path.match(/^\/product\/\d+\/(\d+)/)?.[1] ?? null;
}

/** Nome e preço do produto pela API de afiliados (melhor esforço: sem isso o link continua valendo). */
async function shopeeProductInfo(database: SupabaseClient, accountId: string, productUrl: string) {
  const itemId = shopeeItemId(productUrl);
  if (!itemId) return null;
  try {
    const credentials = await getShopeeIntegrationCredentials(database, accountId);
    if (!credentials || credentials.status !== "connected") return null;
    const data = await shopeeGraphQl<{ productOfferV2?: { nodes?: Array<{ productName?: string; priceMin?: string; imageUrl?: string }> } }>(
      credentials.app_id,
      decryptIntegrationSecret(credentials.encrypted_app_secret),
      "query($itemId:Int64){productOfferV2(itemId:$itemId,limit:1){nodes{productName priceMin imageUrl}}}",
      { itemId },
    );
    const node = data.productOfferV2?.nodes?.[0];
    return node?.productName ? { productName: node.productName, price: node.priceMin ?? null, imageUrl: node.imageUrl ?? null } : null;
  } catch (error) {
    console.warn({ event: "piloto_product_info_failed", component: "piloto-link", error: error instanceof Error ? error.message : "unknown" });
    return null;
  }
}

export async function accountIdByEmail(database: SupabaseClient, email: string) {
  const { data, error } = await database.from("app_users").select("account_id,status")
    .eq("email", email.trim().toLowerCase()).maybeSingle();
  if (error) throw error;
  if (!data?.account_id || data.status === "blocked") return null;
  return data.account_id as string;
}

export async function integrationStatus(database: SupabaseClient, email: string) {
  const accountId = await accountIdByEmail(database, email);
  if (!accountId) return { account: false, shopee: false, amazon: false };
  const [shopee, amazon] = await Promise.all([getShopeeIntegration(database, accountId), getAmazonIntegration(database, accountId)]);
  return { account: true, shopee: shopee?.status === "connected", amazon: amazon?.status === "connected" };
}

export async function affiliateLinkForEmail(database: SupabaseClient, email: string, productUrl: string, fetcher: typeof fetch = fetch) {
  const accountId = await accountIdByEmail(database, email);
  if (!accountId) throw new PilotoLinkError("no_account", "Não encontramos uma conta no Disparei com este e-mail.", 404);
  const product = await resolveProductUrl(productUrl, fetcher);
  try {
    const link = product.marketplace === "shopee"
      ? await shopeeAffiliateLink(database, accountId, product.url)
      : await amazonAffiliateLink(database, accountId, product.url);
    const info = product.marketplace === "shopee" ? await shopeeProductInfo(database, accountId, product.url) : null;
    return { marketplace: product.marketplace, productUrl: product.url, link, productName: info?.productName ?? null, price: info?.price ?? null };
  } catch (error) {
    if (error instanceof StoreLinkError) {
      throw new PilotoLinkError(error.status === 409 ? "not_connected" : "provider", error.message, error.status);
    }
    throw error;
  }
}

/** Números e grupos da aluna no Disparei, para ela escolher onde o achadinho vai. */
export async function dispatchTargets(database: SupabaseClient, email: string) {
  const accountId = await accountIdByEmail(database, email);
  if (!accountId) throw new PilotoLinkError("no_account", "Não encontramos uma conta no Disparei com este e-mail.", 404);
  const [senders, groups] = await Promise.all([
    database.from("whatsapp_senders").select("id,label,session_name,connection_status").eq("account_id", accountId).order("created_at"),
    database.from("grupos").select("group_jid,nome,qtd_membros").eq("account_id", accountId).order("nome").limit(500),
  ]);
  if (senders.error) throw senders.error;
  if (groups.error) throw groups.error;
  return {
    senders: (senders.data ?? []).map((sender) => ({
      id: sender.id as string,
      name: (sender.label as string | null) || (sender.session_name as string),
      connected: sender.connection_status === "connected",
    })),
    groups: (groups.data ?? []).map((group) => ({ jid: group.group_jid as string, name: (group.nome as string | null) ?? "Grupo", members: (group.qtd_membros as number | null) ?? null })),
  };
}

/**
 * Agenda o achadinho do Piloto nos grupos de WhatsApp da aluna, pela mesma fila do Disparei
 * (mesmo espaçamento e as mesmas regras dos outros envios). Só Shopee por enquanto.
 */
export async function scheduleOfferForEmail(database: SupabaseClient, input: {
  email: string; url: string; senderId: string; groupJids: string[]; scheduledAt?: string;
}, fetcher: typeof fetch = fetch) {
  const accountId = await accountIdByEmail(database, input.email);
  if (!accountId) throw new PilotoLinkError("no_account", "Não encontramos uma conta no Disparei com este e-mail.", 404);
  const product = await resolveProductUrl(input.url, fetcher);
  if (product.marketplace !== "shopee") throw new PilotoLinkError("unsupported", "Por enquanto só achadinhos da Shopee vão para os grupos.", 422);
  const itemId = shopeeItemId(product.url);
  if (!itemId) throw new PilotoLinkError("unsupported", "Não achamos o código deste produto na Shopee.", 422);
  let link: string;
  try {
    link = await shopeeAffiliateLink(database, accountId, product.url);
  } catch (error) {
    if (error instanceof StoreLinkError) throw new PilotoLinkError(error.status === 409 ? "not_connected" : "provider", error.message, error.status);
    throw error;
  }
  const info = await shopeeProductInfo(database, accountId, product.url);
  if (!info?.productName) throw new PilotoLinkError("provider", "A Shopee não informou os dados deste produto agora.", 503);
  const price = info.price ? Number(info.price) : undefined;
  const offer: AffiliateOffer = {
    provider: "SHOPEE",
    externalItemId: itemId,
    name: info.productName,
    imageUrl: info.imageUrl ?? undefined,
    priceMin: Number.isFinite(price) ? price : undefined,
    productUrl: product.url,
    affiliateUrl: link,
  } as AffiliateOffer;
  const when = input.scheduledAt ?? new Date().toISOString();
  const message = buildCatalogOfferMessage(offer, link, catalogMessageRandom(offer, brasiliaDate(new Date(when))));
  try {
    const target = await resolveCatalogTarget(accountId, { senderId: input.senderId, groupJids: input.groupJids, imageMode: "original_image" });
    const created = await createCatalogDispatch({ accountId, userId: null, offer, message, target, imageMode: "original_image", scheduledAt: when });
    return { ok: true as const, loteId: created.loteId, total: created.total, scheduledAt: created.scheduledAt, message };
  } catch (error) {
    if (error instanceof CatalogDispatchError) throw new PilotoLinkError("provider", error.message, error.status);
    throw error;
  }
}

/** Só o nome e o preço do produto (sem gerar link), para o catálogo do Piloto mostrar o nome certo. */
export async function productInfoForEmail(database: SupabaseClient, email: string, productUrl: string, fetcher: typeof fetch = fetch) {
  const accountId = await accountIdByEmail(database, email);
  if (!accountId) throw new PilotoLinkError("no_account", "Não encontramos uma conta no Disparei com este e-mail.", 404);
  const product = await resolveProductUrl(productUrl, fetcher);
  const info = product.marketplace === "shopee" ? await shopeeProductInfo(database, accountId, product.url) : null;
  return { marketplace: product.marketplace, productUrl: product.url, productName: info?.productName ?? null, price: info?.price ?? null, imageUrl: info?.imageUrl ?? null };
}
