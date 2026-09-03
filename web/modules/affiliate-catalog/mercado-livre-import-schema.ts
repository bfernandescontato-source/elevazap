import { z } from "zod";

const nullableNumber = z.union([z.number(), z.string()]).transform((value, context) => {
  const parsed = typeof value === "number" ? value : Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) { context.addIssue({ code: z.ZodIssueCode.custom, message: "Número inválido." }); return z.NEVER; }
  return parsed;
}).optional().nullable();

const optionalUrl = z.string().trim().url().max(2000).optional().nullable();

export const mercadoLivreExtensionProductSchema = z.object({
  ml_item_id: z.string().trim().min(3).max(120),
  product_name: z.string().trim().min(1).max(500),
  image_url: optionalUrl,
  price: nullableNumber,
  original_price: nullableNumber,
  commission_rate: nullableNumber,
  commission_value: nullableNumber,
  product_link: optionalUrl,
  category: z.string().trim().max(200).optional().nullable(),
  ml_category: z.string().trim().max(200).optional().nullable(),
  sales: nullableNumber,
  rating_star: nullableNumber.refine(value => value == null || value <= 5, "Avaliação inválida."),
  discount_rate: nullableNumber.refine(value => value == null || value <= 100, "Desconto inválido."),
  is_hot: z.boolean().optional(),
  is_full: z.boolean().optional(),
  free_shipping: z.boolean().optional(),
  seller_name: z.string().trim().max(250).optional().nullable(),
  captured_at: z.string().datetime({ offset: true }).optional(),
  extra_earnings: z.boolean().optional(),
  extra_commission_rate: nullableNumber,
  extra_commission_value: nullableNumber,
  badges: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  source_page: optionalUrl,
  source: z.string().trim().max(80).optional()
}).strict();

export const mercadoLivreExtensionImportSchema = z.union([
  z.array(z.unknown()).min(1).max(500).transform(products => ({ products })),
  z.object({
    source: z.literal("chrome_extension").optional(),
    captured_at: z.string().datetime({ offset: true }).optional(),
    page_url: optionalUrl,
    products: z.array(z.unknown()).min(1).max(500)
  }).strict()
]);

export type MercadoLivreExtensionProduct = z.infer<typeof mercadoLivreExtensionProductSchema>;
