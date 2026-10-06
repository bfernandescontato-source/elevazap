import { z } from "zod";

// Ofertas do dia coletadas pela extensão (Amazon/Magalu) para o catálogo compartilhado.
export const dailyOfferSchema = z.object({
  external_item_id: z.string().min(1).max(120),
  name: z.string().min(1).max(500),
  image_url: z.string().url().optional(),
  price: z.number().nonnegative().optional(),
  original_price: z.number().nonnegative().optional(),
  discount_rate: z.number().min(0).max(100).optional(),
  sales: z.number().nonnegative().optional(),
  product_url: z.string().url().optional(),
  coupon: z.string().max(60).optional(),
  category: z.string().max(120).optional(),
  captured_at: z.string().optional()
});

export const dailyImportSchema = z.object({
  provider: z.enum(["AMAZON", "MAGALU"]),
  offers: z.array(dailyOfferSchema).min(1).max(500)
});
export type DailyOffer = z.infer<typeof dailyOfferSchema>;
