import { z } from "zod";

export const hookModeSchema = z.enum(["system", "own_sequence", "own_random", "fixed", "ai"]);

const hookText = z.string()
  .transform(value => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Escreva o gancho.").max(80, "Use até 80 caracteres."))
  .refine(value => !/(https?:\/\/|www\.)/i.test(value), "O gancho não pode ter link.");

export const hookSettingsSchema = z.object({
  mode: hookModeSchema,
  mixSystem: z.boolean().default(false),
  fixedHookId: z.string().uuid().nullable().default(null)
}).refine(value => value.mode !== "fixed" || value.fixedHookId, { message: "Escolha qual gancho fica fixo.", path: ["fixedHookId"] });

export const createHookSchema = z.object({ text: hookText });
export const updateHookSchema = z.union([
  z.object({ id: z.string().uuid(), text: hookText }),
  z.object({ id: z.string().uuid(), move: z.enum(["up", "down"]) })
]);
export const deleteHookSchema = z.object({ id: z.string().uuid() });
