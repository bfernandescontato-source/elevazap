import { supabaseAdmin } from "@/lib/supabase";
import type { AffiliateOffer, CatalogListing, CatalogPage } from "../types";
import type { DailyOffer } from "../daily-import-schema";

type StoreProvider = "AMAZON" | "MAGALU";

/** Guarda as ofertas do dia coletadas pela extensão. Marca como fora de catálogo
 *  o que não apareceu nesta coleta (para não acumular oferta velha). */
export async function importStoreOffers(provider: StoreProvider, offers: DailyOffer[]) {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const unique = new Map(offers.map(offer => [offer.external_item_id, offer]));
  const rows = [...unique.values()].map(offer => ({
    provider, external_item_id: offer.external_item_id, name: offer.name, image_url: offer.image_url ?? null,
    price: offer.price ?? null, original_price: offer.original_price ?? null, discount_rate: offer.discount_rate ?? null,
    sales: offer.sales == null ? null : Math.trunc(offer.sales), product_url: offer.product_url ?? null,
    coupon: offer.coupon ?? null, category: offer.category ?? null,
    commission_rate: offer.commission_rate ?? null,
    commission_value: offer.commission_rate != null && offer.price != null ? Math.round(offer.price * offer.commission_rate) / 100 : null,
    commission_estimated: offer.commission_estimated ?? false,
    captured_at: offer.captured_at || now, last_seen_at: now, active: true
  }));
  const { error } = await db.from("catalog_store_offers").upsert(rows, { onConflict: "provider,external_item_id" });
  if (error) throw error;
  // Oferta do dia é efêmera: o que não veio nesta coleta sai do catálogo.
  await db.from("catalog_store_offers").update({ active: false }).eq("provider", provider).lt("last_seen_at", now);
  return { received: offers.length, stored: rows.length };
}

function toOffer(row: any): AffiliateOffer {
  return {
    provider: row.provider, externalItemId: row.external_item_id, name: row.name,
    imageUrl: row.image_url || undefined, priceMin: row.price ?? undefined, originalPrice: row.original_price ?? undefined,
    discountPercentage: row.discount_rate ?? undefined, sales: row.sales ?? undefined,
    commissionRate: row.commission_rate ?? undefined, commissionAmount: row.commission_value ?? undefined,
    commissionEstimated: row.commission_estimated || undefined,
    productUrl: row.product_url || undefined, affiliateUrl: row.affiliate_url || undefined
  };
}

export async function getStoredStoreCatalog(provider: StoreProvider, input: { keyword?: string; categoryId?: string; listing: CatalogListing; page: number; limit: number }): Promise<CatalogPage & { categories: import("../types").CatalogCategory[] }> {
  const db = supabaseAdmin();
  let query = db.from("catalog_store_offers").select("*", { count: "exact" }).eq("provider", provider).eq("active", true);
  if (input.keyword) query = query.ilike("name", `%${input.keyword.replace(/[%_,]/g, "")}%`);
  if (input.categoryId) query = query.eq("category", input.categoryId);
  // Esconde cards genéricos de banner (ex.: "Mega Oferta Prime" da Amazon), que não são produtos.
  query = query.not("name", "ilike", "%Mega Oferta%").not("name", "ilike", "%Oferta do Dia%");
  const order = input.listing === "sold" ? "sales" : input.listing === "commission" ? "commission_value" : "last_seen_at";
  const from = (input.page - 1) * input.limit;
  const { data, count, error } = await query.order(order, { ascending: false, nullsFirst: false }).range(from, from + input.limit - 1);
  if (error) throw error;
  const { data: catRows } = await db.from("catalog_store_offers").select("category").eq("provider", provider).eq("active", true).not("category", "is", null).limit(1000);
  const categories = [{ id: null as string | null, label: "Todas" }, ...Array.from(new Set((catRows || []).map((r: any) => r.category).filter(Boolean))).sort().map(c => ({ id: c as string, label: c as string }))];
  return { offers: (data || []).map(toOffer), pageInfo: { page: input.page, limit: input.limit, hasNextPage: (count || 0) > from + input.limit }, categories };
}
