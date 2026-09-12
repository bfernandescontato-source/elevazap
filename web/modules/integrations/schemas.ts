import { z } from "zod";

export const amazonPartnerTagSchema = z.object({
  partner_tag: z.string().trim().min(2).max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "ID de Associado Amazon inválido.")
});

export const amazonLinkConversionSchema = z.object({
  url: z.string().trim().min(1).max(2_048)
});
