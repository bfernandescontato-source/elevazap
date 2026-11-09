import { z } from "zod";
import { OFFER_PAGE_STORES } from "./offer-text";
import { validateSlug } from "./slug";

export const offerPageSettingsSchema = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().toLowerCase().superRefine((value, ctx) => {
    const check = validateSlug(value);
    if (!check.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: check.error });
  }),
  title: z.string().trim().max(60, "O título pode ter até 60 caracteres."),
  bio: z.string().trim().max(140, "A frase pode ter até 140 caracteres."),
  useProfilePhoto: z.boolean(),
  stores: z.array(z.enum(OFFER_PAGE_STORES)).min(1, "Escolha pelo menos uma loja.")
});

export type OfferPageSettingsInput = z.infer<typeof offerPageSettingsSchema>;

export const offerPageBackfillSchema = z.object({
  beforeSentAt: z.string().datetime({ offset: true }).nullable().optional(),
  beforeId: z.string().uuid().nullable().optional()
});
