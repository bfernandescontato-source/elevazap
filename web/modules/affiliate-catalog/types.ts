export type MarketplaceProvider = "SHOPEE" | "MERCADO_LIVRE" | "AMAZON" | "TIKTOK_SHOP";

export type AffiliateOffer = {
  provider: MarketplaceProvider;
  externalItemId: string;
  name: string;
  imageUrl?: string;
  priceMin?: number;
  priceMax?: number;
  originalPrice?: number;
  discountPercentage?: number;
  sales?: number;
  rating?: number;
  commissionRate?: number;
  commissionAmount?: number;
  shopId?: string;
  shopName?: string;
  productUrl?: string;
  affiliateUrl?: string;
  categoryIds?: string[];
  offerStartsAt?: string;
  offerEndsAt?: string;
};

export type CatalogPage = { offers: AffiliateOffer[]; pageInfo: { page: number; limit: number; hasNextPage: boolean } };
export type CatalogListing = "top" | "sold" | "commission";

export interface AffiliateMarketplaceProvider {
  searchProducts(input: { keyword?: string; categoryId?: number; listing: CatalogListing; page: number; limit: number }): Promise<CatalogPage>;
}
