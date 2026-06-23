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

export const mediaKindSchema = z.enum(["imagem", "video", "audio", "audio_voz", "documento"]);

const mediaRules = {
  imagem: { max: 5 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  video: { max: 16 * 1024 * 1024, mimes: ["video/mp4"] },
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

export function validateMedia(kind: z.infer<typeof mediaKindSchema>, mimeType: string, sizeBytes: number) {
  const rule = mediaRules[kind];
  if (!rule.mimes.includes(mimeType as never)) return { ok: false, error: "Tipo de arquivo não permitido." };
  if (sizeBytes > rule.max) return { ok: false, error: "Arquivo acima do limite permitido." };
  return { ok: true, error: null };
}

export const createLoteSchema = z.object({
  titulo: z.string().min(1).max(120),
  group_jids: z.array(z.string()).min(1),
  tipo: z.enum(["texto", "imagem", "video", "audio", "audio_voz", "documento"]),
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
  }).optional()
});

export const createCampanhaSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  group_jids: z.array(z.string()).min(1)
});

export const updateCampanhaSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().trim().min(1).max(120).optional(),
  group_jids: z.array(z.string()).optional()
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
  texto: z.string().optional(),
  media: z.object({
    bucket: z.string(),
    storage_path: z.string(),
    file_name: z.string(),
    mime_type: z.string(),
    file_size_bytes: z.number().int().positive()
  }).nullable().optional()
});
