import { supabaseAdmin } from "@/lib/supabase";
import type { AffiliateOffer, CatalogCategory, CatalogListing, CatalogPage } from "../types";
import type { MercadoLivreExtensionProduct } from "../mercado-livre-import-schema";

const number = (value: unknown) => value == null ? undefined : Number(value);

function commissionFromBadges(product: MercadoLivreExtensionProduct) {
  const badges = product.badges || [];
  const percentage = (pattern: RegExp) => {
    const match = badges.map(badge => badge.match(pattern)).find(Boolean);
    return match?.[1] ? Number(match[1].replace(",", ".")) : undefined;
  };
  const commissionRate = product.commission_rate ?? percentage(/GANHOS?(?!\s+EXTRAS?)[^\d]{0,30}(\d+(?:[.,]\d+)?)\s*%/i);
  const extraCommissionRate = product.extra_commission_rate ?? percentage(/GANHOS?\s+EXTRAS?[^\d]{0,30}(\d+(?:[.,]\d+)?)\s*%/i);
  const money = (value: number | undefined) => product.price != null && value != null ? Math.round(product.price * value) / 100 : null;
  return {
    commissionRate,
    commissionValue: product.commission_value ?? money(commissionRate),
    extraCommissionRate,
    extraCommissionValue: product.extra_commission_value ?? money(extraCommissionRate),
    extraEarnings: product.extra_earnings ?? extraCommissionRate !== undefined
  };
}

export async function importMercadoLivreExtensionProducts(products: MercadoLivreExtensionProduct[], received: number, validationErrors: number) {
  const db = supabaseAdmin(); const started = Date.now(); const now = new Date().toISOString();
  const unique = new Map(products.map(product => [product.ml_item_id, product]));
  const ids = [...unique.keys()];
  const { data: existing, error: existingError } = await db.from("mercado_livre_products").select("ml_item_id,captured_at").in("ml_item_id", ids);
  if (existingError) throw existingError;
  const existingIds = new Set((existing || []).map(row => row.ml_item_id));
  const firstCapturedAt = new Map((existing || []).map(row => [row.ml_item_id, row.captured_at]));
  const inserted = ids.filter(id => !existingIds.has(id)).length; const updated = ids.length - inserted;
  const rows = [...unique.values()].map(product => {
    const commission = commissionFromBadges(product);
    return ({
    ml_item_id: product.ml_item_id, product_name: product.product_name, image_url: product.image_url || null,
    price: product.price ?? null, original_price: product.original_price ?? null,
    commission_rate: commission.commissionRate ?? null, commission_value: commission.commissionValue ?? null,
    product_link: product.product_link || null, category: product.category || null, ml_category: product.ml_category || null,
    sales: product.sales == null ? null : Math.trunc(product.sales), rating_star: product.rating_star ?? null,
    discount_rate: product.discount_rate ?? null, is_hot: product.is_hot ?? false, is_full: product.is_full ?? false,
    free_shipping: product.free_shipping ?? false, seller_name: product.seller_name || null, source: "chrome_extension",
    extra_earnings: commission.extraEarnings, extra_commission_rate: commission.extraCommissionRate ?? null,
    extra_commission_value: commission.extraCommissionValue ?? null, badges: product.badges || [], source_page: product.source_page || null,
    captured_at: firstCapturedAt.get(product.ml_item_id) || product.captured_at || now,
    last_seen_at: now, last_synced_at: now, updated_at: now, active: true
  });
  });
  const { error } = await db.from("mercado_livre_products").upsert(rows, { onConflict: "ml_item_id" });
  if (error) throw error;
  const duplicateCount = products.length - unique.size;
  const { error: logError } = await db.from("mercado_livre_catalog_sync_logs").insert({
    started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(), total_received: received,
    inserted_count: inserted, updated_count: updated, duplicate_count: duplicateCount, error_count: validationErrors,
    duration_ms: Date.now() - started, status: "completed", error_message: validationErrors ? `${validationErrors} produto(s) rejeitado(s) na validação.` : null
  });
  if (logError) throw logError;
  return { received, inserted, updated, errors: validationErrors };
}

export async function mercadoLivreCatalogStats() {
  const db = supabaseAdmin();
  const [{ count, error }, { data: last, error: logError }] = await Promise.all([db.from("mercado_livre_products").select("*", { count: "exact", head: true }).eq("active", true), db.from("mercado_livre_catalog_sync_logs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle()]);
  if (error) throw error; if (logError) throw logError;
  return { totalProducts: count || 0, lastSync: last || null };
}

export async function getStoredMercadoLivreCatalog(input: { keyword?: string; categoryId?: string; minPrice?: number; maxPrice?: number; minCommission?: number; listing: CatalogListing; page: number; limit: number }): Promise<CatalogPage & { categories: CatalogCategory[] }> {
  const db = supabaseAdmin(); let query = db.from("mercado_livre_products").select("*", { count: "exact" }).eq("active", true);
  if (input.keyword) query = query.ilike("product_name", `%${input.keyword.replace(/[%_,]/g, "")} %`.replace(" ", ""));
  if (input.categoryId) query = query.eq("category", input.categoryId);
  if (input.minPrice !== undefined) query = query.gte("price", input.minPrice);
  if (input.maxPrice !== undefined) query = query.lte("price", input.maxPrice);
  if (input.minCommission !== undefined) query = query.gte("commission_rate", input.minCommission);
  const order = input.listing === "commission" ? "commission_value" : input.listing === "sold" ? "sales" : "updated_at";
  const from = (input.page - 1) * input.limit; const { data, count, error } = await query.order(order, { ascending: false, nullsFirst: false }).range(from, from + input.limit - 1);
  if (error) throw error;
  const { data: categoryRows, error: categoryError } = await db.from("mercado_livre_products").select("category").eq("active", true).not("category", "is", null).limit(1000);
  if (categoryError) throw categoryError;
  const categories = [{ id: null, label: "Todas" }, ...Array.from(new Set((categoryRows || []).map(row => row.category).filter(Boolean))).sort().map(category => ({ id: category!, label: category! }))];
  // product_link é a URL pública de origem; o link de afiliado só pode vir do
  // gerador da extensão, que devolve uma URL meli.la validada para a conta.
  const offers: AffiliateOffer[] = (data || []).map(row => ({ provider: "MERCADO_LIVRE", externalItemId: row.ml_item_id, name: row.product_name, imageUrl: row.image_url || undefined, priceMin: number(row.price), originalPrice: number(row.original_price), discountPercentage: number(row.discount_rate), commissionRate: number(row.commission_rate), commissionAmount: number(row.commission_value), extraEarnings: row.extra_earnings || undefined, extraCommissionRate: number(row.extra_commission_rate), extraCommissionAmount: number(row.extra_commission_value), badges: Array.isArray(row.badges) ? row.badges : undefined, productUrl: row.product_link || undefined, categoryIds: row.category ? [row.category] : undefined, sales: number(row.sales), rating: number(row.rating_star), shopName: row.seller_name || undefined }));
  return { offers, categories, pageInfo: { page: input.page, limit: input.limit, hasNextPage: from + offers.length < (count || 0) } };
}
