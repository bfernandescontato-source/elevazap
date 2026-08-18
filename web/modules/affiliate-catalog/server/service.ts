import { decryptIntegrationSecret } from "@/lib/integration-crypto";
import type { CatalogListing, CatalogPage } from "../types";
import { ShopeeAffiliateProvider } from "./shopee-provider";

const cache = new Map<string, { expires: number; value: CatalogPage }>();

export async function getCatalog(database: any, accountId: string, input: { keyword?: string; categoryId?: number; listing: CatalogListing; page: number; limit: number }): Promise<CatalogPage> {
  const { data: integration, error } = await database.from("affiliate_integrations").select("app_id,encrypted_app_secret,status").eq("account_id", accountId).eq("provider", "shopee").maybeSingle();
  if (error) throw error;
  if (!integration || integration.status !== "connected") throw new Error("SHOPEE_NOT_CONNECTED");
  const key = JSON.stringify([accountId, input]);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const provider = new ShopeeAffiliateProvider(integration.app_id, decryptIntegrationSecret(integration.encrypted_app_secret));
  const value = await provider.searchProducts(input);
  cache.set(key, { expires: Date.now() + (input.keyword ? 5 : 10) * 60_000, value });
  if (cache.size > 300) for (const [current, entry] of cache) if (entry.expires <= Date.now()) cache.delete(current);
  return value;
}
