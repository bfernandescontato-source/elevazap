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
export type FollowupMode = "legacy" | "none" | "button" | "sequence";
export type DelayUnit = "minutes" | "hours" | "days";

const variableMappingSchema = z.object({ header: z.record(z.string().max(2048)).optional(), body: z.record(z.string().max(2048)).optional(), buttons: z.record(z.string().max(2048)).optional() }).default({});

// Uma etapa da sequência de follow-up. O gatilho decide o tipo de conteúdo válido — não é uma
// escolha livre: um clique reabre a janela de atendimento de 24h (mensagem livre permitida);
// um atraso de tempo não tem essa garantia, então a etapa precisa ser um template aprovado,
// no mesmo mecanismo da mensagem inicial.
const stepButtonSchema = z.union([
  linkButton,
  z.object({ type: z.literal("quick_reply"), text: z.string().trim().min(1).max(20) })
]).nullable().default(null);

const clickStepSchema = z.object({
  id: z.string().uuid(),
  triggerType: z.literal("click"),
  triggerButtonIndex: z.string().regex(/^\d$/),
  responseType: z.enum(["text", "image", "video", "audio", "document"]),
  responseText: z.string().max(4096).nullable().default(null),
  caption: z.string().max(1024).nullable().default(null),
  mediaBucket: z.literal("whatsapp-media").nullable().default(null),
  mediaPath: z.string().startsWith("official/quick-reply/").refine((path) => !path.includes(".."), "Arquivo inválido.").nullable().default(null),
  mimeType: z.string().max(120).nullable().default(null),
  fileName: z.string().max(255).nullable().default(null),
  buttonConfig: stepButtonSchema
});

const delayStepSchema = z.object({
  id: z.string().uuid(),
  triggerType: z.literal("delay"),
  delayAmount: z.number().int().min(1).max(999),
  delayUnit: z.enum(["minutes", "hours", "days"]),
  templateName: z.string().trim().min(1).max(512),
  templateLanguage: z.string().trim().min(2).max(30),
  variableMapping: variableMappingSchema
});

export const followupStepSchema = z.discriminatedUnion("triggerType", [clickStepSchema, delayStepSchema]).superRefine((step, context) => {
  if (step.triggerType !== "click") return;
  const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (step.responseType === "text" && !step.responseText?.trim()) issue("Escreva a mensagem desta etapa.");
  if (step.responseType !== "text" && (!step.mediaBucket || !step.mediaPath || !step.mimeType)) issue("Envie o arquivo desta etapa.");
  if (step.responseType === "audio" && step.buttonConfig) issue("Áudio não aceita botão.");
  if (step.buttonConfig && !(step.responseType === "text" ? step.responseText : step.caption)?.trim()) issue("Uma mensagem com botão precisa de texto ou legenda.");
  if (step.buttonConfig && ((step.responseType === "text" ? step.responseText : step.caption) || "").length > 1024) issue("Mensagem com botão aceita até 1.024 caracteres.");
});
export type FollowupStep = z.infer<typeof followupStepSchema>;
export type ClickStep = Extract<FollowupStep, { triggerType: "click" }>;
export type DelayStep = Extract<FollowupStep, { triggerType: "delay" }>;

export const followupStepsSchema = z.array(followupStepSchema).max(10, "Limite de 10 etapas por automação.").superRefine((steps, context) => {
  const ids = new Set<string>();
  for (const [index, step] of steps.entries()) {
    if (ids.has(step.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Etapa ${index + 1} duplicada.` });
    ids.add(step.id);
  }
});

export const automationInputSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome à automação.").max(100),
  eventType: z.string().trim().min(1).max(150),
  productId: z.string().trim().min(1).max(200).nullable(),
  productName: z.string().trim().max(200).nullable().default(null),
  connectionId: z.union([z.string().uuid(), z.literal("legacy")]).nullish().transform((value) => !value || value === "legacy" ? null : value),
  templateName: z.string().trim().min(1).max(512),
  templateLanguage: z.string().trim().min(2).max(30),
  variableMapping: variableMappingSchema,
  followupMode: z.enum(["legacy", "none", "button", "sequence"]),
  followupConfig: followupConfigSchema.nullable().default(null),
  followupSteps: followupStepsSchema.default([]),
  active: z.boolean().default(true)
}).superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.followupMode === "button" && !value.followupConfig) issue("Configure a segunda mensagem.");
  if (value.followupMode !== "button" && value.followupConfig) issue("A segunda mensagem deve estar desativada neste modo.");
  if (value.followupMode === "sequence" && !value.followupSteps.length) issue("Adicione ao menos uma etapa.");
  if (value.followupMode !== "sequence" && value.followupSteps.length) issue("Remova as etapas ou mude o modo para sequência.");
});
export type AutomationInput = z.infer<typeof automationInputSchema>;
export function automationButtonPayload(automationId: string) { return `automation:${automationId}:followup`; }
export function automationStepButtonPayload(automationId: string, stepId: string) { return `automation:${automationId}:step:${stepId}`; }
