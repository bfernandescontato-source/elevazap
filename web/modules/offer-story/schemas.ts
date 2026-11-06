import { z } from "zod";
import { offerSchema } from "@/modules/affiliate-catalog/schemas";

export const STATUS_AUDIENCE_GROUPS_MAX = 5;
/** Legenda do Status: curta, com o texto da oferta e o link afiliado. */
export const STATUS_CAPTION_MAX = 700;

export const storyRequestSchema = z.object({ offer: offerSchema });

export const statusPostSchema = z.object({
  offer: offerSchema,
  message: z.string().trim().min(1, "Escreva a mensagem da oferta.").max(STATUS_CAPTION_MAX, `A mensagem do Status pode ter até ${STATUS_CAPTION_MAX} caracteres.`),
  senderId: z.string().uuid("Escolha um número."),
  audienceGroupJids: z.array(z.string().regex(/^\d+(-\d+)?@g\.us$/, "Grupo inválido."))
    .min(1, "Escolha pelo menos um grupo.")
    .max(STATUS_AUDIENCE_GROUPS_MAX, `Escolha até ${STATUS_AUDIENCE_GROUPS_MAX} grupos.`)
});

export type StatusPostInput = z.infer<typeof statusPostSchema>;
