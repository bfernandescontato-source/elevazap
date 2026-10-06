import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptIntegrationSecret } from "@/lib/integration-crypto";
import { getShopeeIntegrationCredentials } from "@/modules/integrations/server/service";
import { shopeeGraphQl } from "@/modules/offer-autopilot/server/shopee-client";

export type ShopeeOffer = { id: string; kind: "loja" | "shopee"; name: string; imageUrl: string | null; offerLink: string; commissionRate: number; ratingStar: number | null };

const limpaNome = (nome: string) => (nome || "").replace(/^[-\s]+/, "").replace(/\s{2,}/g, " ").trim();
const taxa = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round((n <= 1 ? n * 100 : n) * 10) / 10 : 0; };

export async function listShopeeOffers(database: SupabaseClient, accountId: string): Promise<ShopeeOffer[]> {
  const creds = await getShopeeIntegrationCredentials(database, accountId);
  if (!creds || creds.status !== "connected") throw new Error("SHOPEE_NOT_CONNECTED");
  const appId = creds.app_id; const secret = decryptIntegrationSecret(creds.encrypted_app_secret);

  const [lojas, plataforma] = await Promise.all([
    shopeeGraphQl<{ shopOfferV2: { nodes?: any[] } }>(appId, secret, "query{shopOfferV2(page:1,limit:30){nodes{shopName imageUrl offerLink commissionRate ratingStar}}}").catch(() => ({ shopOfferV2: { nodes: [] } })),
    shopeeGraphQl<{ shopeeOfferV2: { nodes?: any[] } }>(appId, secret, "query{shopeeOfferV2(page:1,limit:30){nodes{offerName imageUrl offerLink commissionRate}}}").catch(() => ({ shopeeOfferV2: { nodes: [] } }))
  ]);

  const offers: ShopeeOffer[] = [];
  for (const n of lojas.shopOfferV2?.nodes || []) if (n?.offerLink) offers.push({ id: n.offerLink, kind: "loja", name: limpaNome(n.shopName) || "Loja Shopee", imageUrl: n.imageUrl || null, offerLink: n.offerLink, commissionRate: taxa(n.commissionRate), ratingStar: n.ratingStar ? Number(n.ratingStar) : null });
  for (const n of plataforma.shopeeOfferV2?.nodes || []) if (n?.offerLink) offers.push({ id: n.offerLink, kind: "shopee", name: limpaNome(n.offerName) || "Oferta Shopee", imageUrl: n.imageUrl || null, offerLink: n.offerLink, commissionRate: taxa(n.commissionRate), ratingStar: null });

  const unico = new Map(offers.map(o => [o.offerLink, o]));
  return [...unico.values()].sort((a, b) => b.commissionRate - a.commissionRate);
}
