import { z } from "zod";

export const webhookPayloadSchema = z.object({
  event: z.string(),
  order_id: z.string().min(1),
  transaction_id: z.string().min(1),
  nome: z.string().min(1),
  telefone: z.string().min(8),
  produto: z.string().min(1),
  email: z.string().email()
});

export const sendFlowWebhookPayloadSchema = z.object({
  apiKey: z.string().optional(),
  phoneNumber: z.string().min(8),
  name: z.string().min(1),
  email: z.string().email()
}).passthrough();

export const bulkMensagemClienteSchema = z.object({
  nome: z.string().trim().min(1).max(160),
  telefone: z.string().trim().min(8),
  email: z.string().trim().email().optional().or(z.literal("")),
  produto: z.string().trim().max(160).optional(),
  order_id: z.string().trim().max(160).optional(),
  transaction_id: z.string().trim().max(160).optional()
});

export const bulkMensagemSchema = z.object({
  mensagem: z.string().trim().min(1).max(4000),
  clientes: z.array(bulkMensagemClienteSchema).min(1).max(2000),
  whatsapp_sender_id: z.string().uuid().optional()
});

export const mediaKindSchema = z.enum(["imagem", "video", "audio", "audio_voz", "documento"]);

const mediaRules = {
  imagem: { max: 5 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  video: { max: 50 * 1024 * 1024, mimes: ["video/mp4"] },
  audio: { max: 16 * 1024 * 1024, mimes: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/x-m4a"] },
  audio_voz: { max: 16 * 1024 * 1024, mimes: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/x-m4a"] },
  documento: {
    max: 100 * 1024 * 1024,
    mimes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ]
  }
} as const;

export function validateMedia(kind: z.infer<typeof mediaKindSchema>, mimeType: string, sizeBytes: number, channel: "baileys" | "official" = "baileys") {
  const rule = mediaRules[kind];
  const max = channel === "official" && kind === "video" ? 16 * 1024 * 1024 : rule.max;
  if (!rule.mimes.includes(mimeType as never)) return { ok: false, error: "Tipo de arquivo não permitido." };
  if (sizeBytes > max) return { ok: false, error: "Arquivo acima do limite permitido." };
  return { ok: true, error: null };
}

export const pollSchema = z.object({
  name: z.string().trim().min(1, "Escreva a pergunta da enquete.").max(255),
  values: z.array(z.string().trim().min(1, "Preencha todas as alternativas.").max(100)).min(2).max(12),
  selectableCount: z.number().int().min(1).max(12)
}).superRefine((poll, context) => {
  if (new Set(poll.values.map(value => value.toLocaleLowerCase("pt-BR"))).size !== poll.values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "As alternativas precisam ser diferentes.", path: ["values"] });
  }
  if (poll.selectableCount > poll.values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Quantidade de respostas inválida.", path: ["selectableCount"] });
  }
});

export const createLoteSchema = z.object({
  titulo: z.string().min(1).max(120),
  campanha_id: z.string().uuid().optional(),
  modelo_mensagem_id: z.string().uuid().optional(),
  group_jids: z.array(z.string()).min(1),
  whatsapp_sender_id: z.string().uuid().optional(),
  tipo: z.enum(["texto", "imagem", "video", "audio", "audio_voz", "documento", "enquete"]),
  poll: pollSchema.nullable().optional(),
  texto: z.string().optional(),
  legenda: z.string().optional(),
  mention_all: z.boolean().optional(),
  scheduled_at: z.string().datetime().optional(),
  media: z.object({
    bucket: z.string(),
    storage_path: z.string(),
    file_name: z.string(),
    mime_type: z.string(),
    file_size_bytes: z.number().int().positive()
  }).nullable().optional()
}).superRefine((body, context) => {
  if (body.tipo === "enquete" && !body.poll) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Preencha a pergunta e as alternativas da enquete.", path: ["poll"] });
  }
  if (body.tipo === "enquete" && (body.media || body.mention_all)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enquetes não aceitam arquivo ou menção a todos.", path: ["poll"] });
  }
  if (body.tipo !== "enquete" && body.poll) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Selecione o tipo Enquete para enviar uma enquete.", path: ["poll"] });
  }
});

export const createCampanhaSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  group_jids: z.array(z.string()).min(1),
  whatsapp_sender_id: z.string().uuid().nullable().optional()
});

export const updateCampanhaSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().trim().min(1).max(120).optional(),
  group_jids: z.array(z.string()).optional(),
  whatsapp_sender_id: z.string().uuid().nullable().optional()
});

export const modeloMensagemTipoSchema = z.enum(["texto", "imagem", "video", "audio", "documento"]);

export const modeloPastaSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().trim().min(1).max(120)
});

export const modeloMensagemSchema = z.object({
  id: z.string().uuid().optional(),
  pasta_id: z.string().uuid().nullable().optional(),
  nome: z.string().trim().min(1).max(120),
  tipo: modeloMensagemTipoSchema,
  texto: z.string().nullable().optional(),
  mention_all: z.boolean().optional(),
  media: z.object({
    bucket: z.string(),
    storage_path: z.string(),
    file_name: z.string(),
    mime_type: z.string(),
    file_size_bytes: z.number().int().positive()
  }).nullable().optional()
});
