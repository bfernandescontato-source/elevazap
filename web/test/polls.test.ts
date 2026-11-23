import { describe, expect, it } from "vitest";
import { createLoteSchema, pollSchema } from "../lib/schemas";

const poll = { name: " Qual horário? ", values: [" Manhã ", "Noite"], selectableCount: 1 };
const batch = { titulo: "Teste", group_jids: ["120363123456@g.us"], tipo: "enquete", poll };

describe("enquetes nos disparos", () => {
  it("normaliza a pergunta e alternativas e preserva o agendamento", () => {
    const parsed = createLoteSchema.parse({ ...batch, scheduled_at: "2026-12-01T15:00:00Z" });
    expect(parsed.poll).toEqual({ ...poll, name: "Qual horário?", values: ["Manhã", "Noite"] });
    expect(parsed.scheduled_at).toBe("2026-12-01T15:00:00Z");
  });
  it("aceita escolha múltipla com até 12 alternativas", () => {
    expect(pollSchema.safeParse({ ...poll, values: Array.from({ length: 12 }, (_, i) => `Opção ${i}`), selectableCount: 12 }).success).toBe(true);
  });
  it.each([
    { ...poll, name: " " },
    { ...poll, values: ["Uma"] },
    { ...poll, values: ["Uma", " "] },
    { ...poll, values: ["Sim", " sim "] },
    { ...poll, values: Array.from({ length: 13 }, (_, i) => `Opção ${i}`) },
    { ...poll, selectableCount: 3 },
    { ...poll, selectableCount: 0 }
  ])("rejeita pergunta, alternativas ou seleção inválidas", invalid => {
    expect(pollSchema.safeParse(invalid).success).toBe(false);
  });
  it("rejeita enquete ausente e combinações que não podem ser enviadas", () => {
    expect(createLoteSchema.safeParse({ ...batch, poll: undefined }).success).toBe(false);
    expect(createLoteSchema.safeParse({ ...batch, mention_all: true }).success).toBe(false);
    expect(createLoteSchema.safeParse({ ...batch, tipo: "texto" }).success).toBe(false);
  });
});
