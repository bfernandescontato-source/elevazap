import { z } from "zod";

export const offerImageModeSchema = z.enum(["original_image", "product_link_preview"]);

export const offerImageSettingsSchema = z.object({
  defaultImageMode: offerImageModeSchema,
  discountBadge: z.boolean(),
  freeShippingBadge: z.boolean()
});

export const offerBadgePreviewSchema = z.object({
  mode: z.enum(["card", "original"]).default("card"),
  discount: z.enum(["0", "1"]).default("1"),
  freeShipping: z.enum(["0", "1"]).default("1")
});

/** Desconto usado na foto de exemplo da tela de Configurações. */
export const SAMPLE_DISCOUNT_PERCENT = 52;
