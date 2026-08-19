import { decryptIntegrationSecret } from "@/lib/integration-crypto";
import { catalogCategories } from "../categories";
import type { CatalogCategory, CatalogListing, CatalogPage, CatalogProviderFilter } from "../types";
import { withMercadoLivreAuthRetry } from "./mercado-livre-token-manager";
import { ShopeeAffiliateProvider } from "./shopee-provider";

type CatalogResult = CatalogPage & { categories: CatalogCategory[]; providerErrors: Partial<Record<"SHOPEE" | "MERCADO_LIVRE", string>> };
const cache = new Map<string, { expires: number; value: CatalogPage | CatalogCategory[] }>();

function cached<T extends CatalogPage | CatalogCategory[]>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value as T);
  return load().then(value => {
    cache.set(key, { expires: Date.now() + ttl, value });
    if (cache.size > 400) for (const [current, entry] of cache) if (entry.expires <= Date.now()) cache.delete(current);
    return value;
  });
}

async function shopeeProvider(database: any, accountId: string) {
  const { data, error } = await database.from("affiliate_integrations").select("app_id,encrypted_app_secret,status").eq("account_id", accountId).eq("provider", "shopee").maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "connected") throw new Error("SHOPEE_NOT_CONNECTED");
  return new ShopeeAffiliateProvider(data.app_id, decryptIntegrationSecret(data.encrypted_app_secret));
}

function codeOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

export async function getCatalog(database: any, accountId: string, input: { provider: CatalogProviderFilter; keyword?: string; categoryId?: string; listing: CatalogListing; page: number; limit: number }): Promise<CatalogResult> {
  const providers: Array<"SHOPEE" | "MERCADO_LIVRE"> = input.provider === "ALL" ? ["SHOPEE", "MERCADO_LIVRE"] : [input.provider];
  const settled = await Promise.allSettled(providers.map(async provider => {
    const categoryId = input.provider === "ALL" ? undefined : input.categoryId;
    const key = JSON.stringify([provider, accountId, { ...input, categoryId }]);
    const ttl = (input.keyword ? 5 : 10) * 60_000;
    if (provider === "SHOPEE") {
      const adapter = await shopeeProvider(database, accountId);
      return cached(key, ttl, () => adapter.searchProducts({ ...input, categoryId }));
    }
    return cached(key, ttl, () => withMercadoLivreAuthRetry(client => client.searchProducts({ ...input, categoryId })));
  }));
  const providerErrors: CatalogResult["providerErrors"] = {};
  const pages: CatalogPage[] = [];
  settled.forEach((result, index) => {
    const provider = providers[index];
    if (result.status === "fulfilled") pages.push(result.value);
    else providerErrors[provider] = codeOf(result.reason, `${provider}_UNAVAILABLE`);
  });
  if (!pages.length) throw new Error(providerErrors[input.provider === "ALL" ? "SHOPEE" : input.provider] || Object.values(providerErrors)[0] || "CATALOG_UNAVAILABLE");
  const offers = pages.flatMap(page => page.offers).sort((a, b) => {
    if (input.listing === "commission") return (b.commissionAmount ?? -1) - (a.commissionAmount ?? -1);
    if (input.listing === "sold") return (b.sales ?? -1) - (a.sales ?? -1);
    return 0;
  });
  let categories: CatalogCategory[] = [{ id: null, label: "Todas" }];
  if (input.provider === "SHOPEE") categories = catalogCategories.map(category => ({ ...category, id: category.id === null ? null : String(category.id) }));
  if (input.provider === "MERCADO_LIVRE") {
    try { categories = await cached("mercado-livre:categories", 24 * 60 * 60_000, () => withMercadoLivreAuthRetry(client => client.getCategories())); }
    catch (error) { providerErrors.MERCADO_LIVRE ||= codeOf(error, "MERCADO_LIVRE_CATEGORIES_UNAVAILABLE"); }
  }
  return { offers, pageInfo: { page: input.page, limit: input.limit, hasNextPage: pages.some(page => page.pageInfo.hasNextPage) }, categories, providerErrors };
}
