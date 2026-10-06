import { describe, expect, it } from "vitest";
import { parseFlowInput } from "@/modules/official-whatsapp/server/flows";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Quiz",
    initialTemplateName: "quiz_confirmation",
    initialTemplateLanguage: "pt_BR",
    variableMapping: {},
    quickReplyPayload: "VER DETALHES",
    quickReplyLabel: "Quero acessar",
    followupResponseType: "text",
    followupResponseText: "Segunda mensagem",
    followupButtonConfig: null,
    ...overrides
  };
}

describe("mensagens adicionais de fluxos", () => {
  it("mantém compatibilidade com fluxos sem mensagens adicionais", () => {
    const parsed = parseFlowInput(validBody());
    expect("error" in parsed).toBe(false);
    if (!("error" in parsed)) expect(parsed.additionalMessages).toEqual([]);
  });

  it("aceita e normaliza mensagens separadas", () => {
    const parsed = parseFlowInput(validBody({ additionalMessages: [" Terceira mensagem ", "Quarta mensagem"] }));
    expect("error" in parsed).toBe(false);
    if (!("error" in parsed)) expect(parsed.additionalMessages).toEqual(["Terceira mensagem", "Quarta mensagem"]);
  });

  it("rejeita mensagem vazia e mais de dez mensagens extras", () => {
    expect(parseFlowInput(validBody({ additionalMessages: [""] }))).toEqual({ error: "Preencha ou remova as mensagens extras vazias." });
    expect(parseFlowInput(validBody({ additionalMessages: Array.from({ length: 11 }, () => "Texto") }))).toEqual({ error: "Adicione no máximo 10 mensagens extras." });
  });
});
