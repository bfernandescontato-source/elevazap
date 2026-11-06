import { z } from "zod";
import { MAX_GROUPS, MAX_TIMES_PER_DAY, isValidTime, normalizeTimes, normalizeWeekdays, textWithoutPlaceholder } from "./schedule";

const mediaSchema = z.object({
  bucket: z.literal("whatsapp-media"),
  storage_path: z.string().min(1).max(400),
  file_name: z.string().min(1).max(160),
  mime_type: z.string().min(1).max(100),
  file_size_bytes: z.number().int().positive()
});

const baseSchema = z.object({
  nome: z.string().trim().min(1, "Dê um nome para a mensagem.").max(80, "Nome muito longo."),
  tipo: z.enum(["texto", "imagem"]).default("texto"),
  texto: z.string().max(4096, "Texto muito longo.").default(""),
  media: mediaSchema.nullable().optional(),
  whatsapp_sender_id: z.string().uuid("Escolha o número que vai enviar."),
  group_jids: z.array(z.string().regex(/^\d+(-\d+)?@g\.us$/)).min(1, "Escolha ao menos um grupo.").max(MAX_GROUPS, `Escolha até ${MAX_GROUPS} grupos.`),
  horarios: z.array(z.string().refine(isValidTime, "Horário inválido.")).min(1, "Adicione ao menos um horário.").max(MAX_TIMES_PER_DAY, `Use até ${MAX_TIMES_PER_DAY} horários por dia.`),
  dias_semana: z.array(z.number().int().min(1).max(7)).min(1, "Escolha ao menos um dia da semana.").max(7),
  ativo: z.boolean().default(true)
});

function refineContent<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value: any, ctx) => {
    if (value.tipo === "texto" && !textWithoutPlaceholder(value.texto || "")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Escreva o texto da mensagem.", path: ["texto"] });
    }
    if (value.tipo === "imagem" && !value.media) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Escolha a imagem.", path: ["media"] });
    }
  }).transform((value: any) => ({
    ...value,
    group_jids: Array.from(new Set<string>(value.group_jids)),
    horarios: normalizeTimes(value.horarios),
    dias_semana: normalizeWeekdays(value.dias_semana)
  }));
}

export const recurringMessageInputSchema = refineContent(baseSchema);
export type RecurringMessageInput = z.infer<typeof recurringMessageInputSchema>;

/** Liga e desliga sem reenviar o resto. */
export const recurringMessageToggleSchema = z.object({ ativo: z.boolean() });
