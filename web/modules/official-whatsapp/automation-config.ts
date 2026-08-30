import { z } from "zod";

const linkButton = z.object({ type: z.literal("url"), text: z.string().trim().min(1).max(20), url: z.string().url().refine((url) => /^https?:\/\//i.test(url), "Use um link http ou https.") });
export const followupConfigSchema = z.object({
  triggerButtonIndex: z.string().regex(/^\d$/),
  responseType: z.enum(["text", "image", "video", "audio", "document"]),
  responseText: z.string().max(4096).nullable().default(null),
  caption: z.string().max(1024).nullable().default(null),
  mediaBucket: z.literal("whatsapp-media").nullable().default(null),
  mediaPath: z.string().startsWith("official/quick-reply/").refine((path) => !path.includes(".."), "Arquivo inválido.").nullable().default(null),
  mimeType: z.string().max(120).nullable().default(null),
  fileName: z.string().max(255).nullable().default(null),
  buttonConfig: linkButton.nullable().default(null)
}).superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.responseType === "text" && !value.responseText?.trim()) issue("Escreva a segunda mensagem.");
  if (value.responseType !== "text" && (!value.mediaBucket || !value.mediaPath || !value.mimeType)) issue("Envie o arquivo da segunda mensagem.");
  if (value.responseType === "audio" && value.buttonConfig) issue("Áudio não aceita botão.");
  if (value.buttonConfig && !(value.responseType === "text" ? value.responseText : value.caption)?.trim()) issue("Uma mensagem com botão precisa de texto ou legenda.");
  if (value.buttonConfig && ((value.responseType === "text" ? value.responseText : value.caption) || "").length > 1024) issue("Mensagem com botão aceita até 1.024 caracteres.");
});
export type FollowupConfig = z.infer<typeof followupConfigSchema>;
export type FollowupMode = "legacy" | "none" | "button";
export const automationInputSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome à automação.").max(100),
  eventType: z.string().trim().min(1).max(150),
  productId: z.string().trim().min(1).max(200).nullable(),
  productName: z.string().trim().max(200).nullable().default(null),
  connectionId: z.union([z.string().uuid(), z.literal("legacy")]).nullish().transform((value) => !value || value === "legacy" ? null : value),
  templateName: z.string().trim().min(1).max(512),
  templateLanguage: z.string().trim().min(2).max(30),
  variableMapping: z.object({ header: z.record(z.string().max(2048)).optional(), body: z.record(z.string().max(2048)).optional(), buttons: z.record(z.string().max(2048)).optional() }).default({}),
  followupMode: z.enum(["legacy", "none", "button"]),
  followupConfig: followupConfigSchema.nullable().default(null),
  active: z.boolean().default(true)
}).superRefine((value, context) => {
  if (value.followupMode === "button" && !value.followupConfig) context.addIssue({ code: z.ZodIssueCode.custom, message: "Configure a segunda mensagem." });
  if (value.followupMode !== "button" && value.followupConfig) context.addIssue({ code: z.ZodIssueCode.custom, message: "A segunda mensagem deve estar desativada neste modo." });
});
export type AutomationInput = z.infer<typeof automationInputSchema>;
export function automationButtonPayload(automationId: string) { return `automation:${automationId}:followup`; }
