import { shopeeGraphQl } from "@/modules/offer-autopilot/server/shopee-client";
import type { AffiliateMarketplaceProvider, AffiliateOffer, CatalogPage } from "../types";

type ShopeeNode = Record<string, unknown>;
type ShopeeResult = { productOfferV2: { nodes?: ShopeeNode[]; pageInfo?: { page?: number; limit?: number; hasNextPage?: boolean } } };

const number = (value: unknown) => value === null || value === undefined || value === "" ? undefined : Number(value);
const rate = (value: unknown) => { const parsed = number(value); return parsed !== undefined && parsed <= 1 ? parsed * 100 : parsed; };
const date = (value: unknown) => number(value) ? new Date(Number(value) * 1000).toISOString() : undefined;

export function normalizeShopeeOffer(node: ShopeeNode): AffiliateOffer {
  const priceMin = number(node.priceMin);
  const discountPercentage = number(node.priceDiscountRate);
  const originalPrice = priceMin && discountPercentage && discountPercentage < 100
    ? priceMin / (1 - discountPercentage / 100) : undefined;
  return {
    provider: "SHOPEE",
    externalItemId: String(node.itemId),
    name: String(node.productName || "Produto Shopee"),
    imageUrl: node.imageUrl ? String(node.imageUrl) : undefined,
    priceMin,
    priceMax: number(node.priceMax),
    originalPrice,
    discountPercentage,
    sales: number(node.sales),
    rating: number(node.ratingStar),
    commissionRate: rate(node.commissionRate),
    commissionAmount: number(node.commission),
    shopId: node.shopId ? String(node.shopId) : undefined,
    shopName: node.shopName ? String(node.shopName) : undefined,
    productUrl: node.productLink ? String(node.productLink) : undefined,
    affiliateUrl: node.offerLink ? String(node.offerLink) : undefined,
    categoryIds: Array.isArray(node.productCatIds) ? node.productCatIds.map(String) : undefined,
    offerStartsAt: date(node.periodStartTime),
    offerEndsAt: date(node.periodEndTime)
  };
}

export class ShopeeAffiliateProvider implements AffiliateMarketplaceProvider {
  constructor(private appId: string, private appSecret: string) {}
  async searchProducts(input: { keyword?: string; categoryId?: string; listing: "top" | "sold" | "commission"; page: number; limit: number }): Promise<CatalogPage> {
    const variables: Record<string, unknown> = { page: input.page, limit: input.limit };
    const definitions = ["$page:Int!", "$limit:Int!"];
    const args = ["page:$page", "limit:$limit"];
    if (input.keyword) { variables.keyword = input.keyword; definitions.push("$keyword:String!"); args.push("keyword:$keyword"); }
    if (input.categoryId) { variables.productCatId = Number(input.categoryId); definitions.push("$productCatId:Int!"); args.push("productCatId:$productCatId"); }
    if (input.listing === "top") args.push("listType:2");
    else args.push(`sortType:${input.listing === "sold" ? 2 : 5}`);
    const query = `query Catalog(${definitions.join(",")}) { productOfferV2(${args.join(",")}) { nodes { itemId productName imageUrl priceMin priceMax priceDiscountRate sales ratingStar commissionRate sellerCommissionRate shopeeCommissionRate commission productCatIds shopId shopName shopType productLink offerLink periodStartTime periodEndTime } pageInfo { page limit hasNextPage } } }`;
    const data = await shopeeGraphQl<ShopeeResult>(this.appId, this.appSecret, query, variables);
    const result = data.productOfferV2;
    return { offers: (result.nodes || []).map(normalizeShopeeOffer), pageInfo: { page: result.pageInfo?.page || input.page, limit: result.pageInfo?.limit || input.limit, hasNextPage: Boolean(result.pageInfo?.hasNextPage) } };
  }
}
