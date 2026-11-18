import { z } from "zod";

const pollSchema = z.object({
  name: z.string().trim().min(1).max(255),
  values: z.array(z.string().trim().min(1).max(100)).min(2).max(12),
  selectableCount: z.number().int().min(1).max(12)
}).refine(poll => poll.selectableCount <= poll.values.length
  && new Set(poll.values.map(value => value.toLocaleLowerCase("pt-BR"))).size === poll.values.length, "Enquete inválida.");

export function buildPollMessage(poll: unknown) {
  return { poll: pollSchema.parse(poll) };
}
