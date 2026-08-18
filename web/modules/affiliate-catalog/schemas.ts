import { z } from "zod";

export const offerSchema = z.object({
  provider: z.literal("SHOPEE"), externalItemId: z.string().min(1), name: z.string().min(1).max(500),
  imageUrl: z.string().url().optional(), priceMin: z.number().nonnegative().optional(), priceMax: z.number().nonnegative().optional(),
  originalPrice: z.number().nonnegative().optional(), discountPercentage: z.number().min(0).max(100).optional(), sales: z.number().nonnegative().optional(),
  rating: z.number().min(0).max(5).optional(), commissionRate: z.number().nonnegative().optional(), commissionAmount: z.number().nonnegative().optional(),
  shopId: z.string().optional(), shopName: z.string().optional(), productUrl: z.string().url().optional(), affiliateUrl: z.string().url().optional(),
  categoryIds: z.array(z.string()).optional(), offerStartsAt: z.string().optional(), offerEndsAt: z.string().optional()
});

export const aiMessageSchema = z.object({
  offer: offerSchema, style: z.enum(["achadinho", "rapida", "desconto", "natural", "ultra_curta"]),
  length: z.enum(["curta", "media"]), instruction: z.enum(["generate", "shorter", "aggressive", "natural", "headline"]).default("generate"),
  currentMessage: z.string().max(4000).optional()
});

export const dispatchOfferSchema = z.object({
  offer: offerSchema, message: z.string().trim().min(1).max(4000), senderId: z.string().uuid(),
  groupJids: z.array(z.string()).min(1).max(500), scheduledAt: z.string().datetime().optional()
});
