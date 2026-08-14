import { z } from "zod";

export const automationConfigSchema = z.object({
  whatsapp_sender_id: z.string().uuid(),
  enabled: z.boolean(),
  interval_minutes: z.number().int().min(5).max(1440),
  operating_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  operating_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(3).max(100),
  keep_original_text: z.boolean(),
  keep_original_media: z.boolean(),
  avoid_duplicates: z.boolean(),
  shopee_conversion_enabled: z.boolean(),
  conversion_failure_policy: z.enum(["pause", "send_original"]),
  source_group_ids: z.array(z.string().endsWith("@g.us")).max(500),
  destination_group_ids: z.array(z.string().endsWith("@g.us")).max(500)
}).superRefine((value, context) => {
  if (value.operating_start >= value.operating_end) context.addIssue({ code: "custom", message: "O horário inicial deve ser anterior ao final." });
  if (value.enabled && !value.source_group_ids.length) context.addIssue({ code: "custom", message: "Escolha ao menos um grupo fonte." });
  if (value.enabled && !value.destination_group_ids.length) context.addIssue({ code: "custom", message: "Escolha ao menos um grupo de destino." });
});

export const offerActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ignore") }),
  z.object({ action: z.literal("dispatch_now") }),
  z.object({ action: z.literal("retry_conversion") }),
  z.object({ action: z.literal("edit"), text: z.string().trim().min(1).max(10000) })
]);

export const shopeeIntegrationSchema = z.object({
  app_id: z.string().trim().min(1).max(120),
  app_secret: z.string().min(1).max(500)
});
