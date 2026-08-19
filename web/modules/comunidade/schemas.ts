import { z } from "zod";

export const communityCategories = ["resultado", "oferta", "trafego", "automacao", "duvida", "estrategia", "aviso", "geral"] as const;
export const communityMarketplaces = ["shopee", "mercado_livre", "amazon", "tiktok_shop", "outro"] as const;
export const communityReportReasons = ["spam", "conteudo_impropriado", "golpe", "informacao_enganosa", "outro"] as const;

export const createPostSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  category: z.enum(communityCategories).default("geral"),
  image_paths: z.array(z.string().min(1)).max(4).default([]),
  result_amount_cents: z.number().int().min(0).nullable().optional(),
  result_marketplace: z.enum(communityMarketplaces).nullable().optional()
}).superRefine((value, context) => {
  if (value.category !== "resultado" && (value.result_amount_cents != null || value.result_marketplace != null)) {
    context.addIssue({ code: "custom", message: "Campos de resultado só valem para a categoria Resultados." });
  }
});

export const ADMIN_POST_ACTIONS = new Set(["hide", "unhide", "pin", "unpin", "mark_official", "unmark_official", "delete_any"]);

export const postActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), content: z.string().trim().min(1).max(5000) }),
  z.object({ action: z.literal("delete_own") }),
  z.object({ action: z.literal("hide") }),
  z.object({ action: z.literal("unhide") }),
  z.object({ action: z.literal("pin") }),
  z.object({ action: z.literal("unpin") }),
  z.object({ action: z.literal("mark_official") }),
  z.object({ action: z.literal("unmark_official") }),
  z.object({ action: z.literal("delete_any") })
]);

export const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(2000)
});

export const ADMIN_COMMENT_ACTIONS = new Set(["delete_any"]);

export const commentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete_own") }),
  z.object({ action: z.literal("delete_any") })
]);

export const reportPostSchema = z.object({
  reason: z.enum(communityReportReasons),
  details: z.string().trim().max(2000).optional()
});

export const listPostsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  category: z.enum(communityCategories).optional()
});
