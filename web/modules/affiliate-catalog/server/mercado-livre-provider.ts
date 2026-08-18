import type { AffiliateMarketplaceProvider, AffiliateOffer, CatalogCategory, CatalogPage } from "../types";

type MlSearchResult = {
  id?: string; title?: string; thumbnail?: string; price?: number; original_price?: number;
  permalink?: string; sold_quantity?: number; seller?: { id?: number; nickname?: string };
  category_id?: string;
};
type MlSearchResponse = { results?: MlSearchResult[]; paging?: { total?: number; offset?: number; limit?: number } };

const API = "https://api.mercadolibre.com";

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeMercadoLivreOffer(item: MlSearchResult): AffiliateOffer {
  const price = number(item.price);
  const originalPrice = number(item.original_price);
  const discountPercentage = price !== undefined && originalPrice && originalPrice > price
    ? Math.round((1 - price / originalPrice) * 100) : undefined;
  return {
    provider: "MERCADO_LIVRE",
    externalItemId: String(item.id || ""),
    name: String(item.title || "Produto Mercado Livre"),
    imageUrl: item.thumbnail?.replace(/^http:/, "https:").replace(/-I\.jpg$/i, "-O.jpg"),
    priceMin: price,
    originalPrice,
    discountPercentage,
    sales: number(item.sold_quantity),
    shopId: item.seller?.id ? String(item.seller.id) : undefined,
    shopName: item.seller?.nickname || undefined,
    productUrl: item.permalink,
    categoryIds: item.category_id ? [item.category_id] : undefined
  };
}

export class MercadoLivreAffiliateProvider implements AffiliateMarketplaceProvider {
  constructor(private accessToken: string, private fetcher: typeof fetch = fetch) {}

  private async request<T>(path: string, params?: URLSearchParams): Promise<T> {
    const url = new URL(path, API);
    if (params) url.search = params.toString();
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(10_000)
      });
    } catch { throw new Error("MERCADO_LIVRE_UNAVAILABLE"); }
    if (response.status === 401 || response.status === 403) throw new Error("MERCADO_LIVRE_AUTH");
    if (response.status === 429) throw new Error("MERCADO_LIVRE_RATE_LIMIT");
    if (!response.ok) throw new Error("MERCADO_LIVRE_UNAVAILABLE");
    return response.json() as Promise<T>;
  }

  async getCategories(): Promise<CatalogCategory[]> {
    const categories = await this.request<Array<{ id: string; name: string }>>("/sites/MLB/categories");
    return [{ id: null, label: "Todas" }, ...categories.map(category => ({ id: category.id, label: category.name }))];
  }

  async searchProducts(input: { keyword?: string; categoryId?: string; listing: "top" | "sold" | "commission"; page: number; limit: number }): Promise<CatalogPage> {
    let keyword = input.keyword;
    if (!keyword && input.listing === "top") {
      const trendPath = input.categoryId ? `/trends/MLB/${encodeURIComponent(input.categoryId)}` : "/trends/MLB";
      const trends = await this.request<Array<{ keyword?: string }>>(trendPath);
      keyword = trends[(input.page - 1) % Math.max(trends.length, 1)]?.keyword;
    }
    const params = new URLSearchParams({ offset: String((input.page - 1) * input.limit), limit: String(input.limit) });
    if (keyword) params.set("q", keyword);
    if (input.categoryId) params.set("category", input.categoryId);
    if (input.listing === "sold") params.set("sort", "sold_quantity_desc");
    const data = await this.request<MlSearchResponse>("/sites/MLB/search", params);
    const offers = (data.results || []).filter(item => item.id && item.title).map(normalizeMercadoLivreOffer);
    const total = data.paging?.total || 0;
    const offset = data.paging?.offset ?? (input.page - 1) * input.limit;
    const limit = data.paging?.limit || input.limit;
    return { offers, pageInfo: { page: input.page, limit, hasNextPage: offset + limit < total } };
  }
}
