import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { automationInputSchema, automationStepButtonPayload, followupStepSchema, followupStepsSchema } from "../modules/official-whatsapp/automation-config";
import { buildNextStepButtonComponent, delayToMs } from "../modules/official-whatsapp/server/automation-chain";

const clickStep = () => ({ id: randomUUID(), trigger: { type: "click" as const, triggerButtonIndex: "0" }, responseType: "text" as const, responseText: "Seu acesso está pronto!", caption: null, mediaBucket: null, mediaPath: null, mimeType: null, fileName: null, buttonConfig: null });
const delayStep = () => ({ id: randomUUID(), trigger: { type: "delay" as const, delayAmount: 10, delayUnit: "minutes" as const }, responseType: "text" as const, responseText: "Segue a próxima etapa!", caption: null, mediaBucket: null, mediaPath: null, mimeType: null, fileName: null, buttonConfig: null });

describe("followupStepSchema: mensagem livre com gatilho por clique ou por atraso", () => {
  it("aceita uma etapa de cada gatilho", () => {
    expect(followupStepSchema.safeParse(clickStep()).success).toBe(true);
    expect(followupStepSchema.safeParse(delayStep()).success).toBe(true);
  });
  it("recusa etapa com texto vazio", () => {
    expect(followupStepSchema.safeParse({ ...clickStep(), responseText: null }).success).toBe(false);
    expect(followupStepSchema.safeParse({ ...delayStep(), responseText: null }).success).toBe(false);
  });
  it("recusa etapa de mídia sem arquivo", () => {
    expect(followupStepSchema.safeParse({ ...clickStep(), responseType: "image", responseText: null }).success).toBe(false);
  });
  it("recusa áudio com botão", () => {
    expect(followupStepSchema.safeParse({ ...clickStep(), responseType: "audio", mediaBucket: "whatsapp-media", mediaPath: "official/quick-reply/x", mimeType: "audio/mpeg", buttonConfig: { type: "quick_reply", text: "CONTINUAR" } }).success).toBe(false);
  });
  it("aceita botão do tipo continuar sequência sem exigir payload do admin", () => {
    const step = { ...clickStep(), buttonConfig: { type: "quick_reply" as const, text: "CONTINUAR" } };
    expect(followupStepSchema.safeParse(step).success).toBe(true);
  });
  it("recusa amount de atraso fora do intervalo", () => {
    expect(followupStepSchema.safeParse({ ...delayStep(), trigger: { type: "delay", delayAmount: 0, delayUnit: "minutes" } }).success).toBe(false);
    expect(followupStepSchema.safeParse({ ...delayStep(), trigger: { type: "delay", delayAmount: 1000, delayUnit: "minutes" } }).success).toBe(false);
  });
  it("uma etapa por atraso é mensagem livre, sem exigir modelo aprovado", () => {
    const parsed = followupStepSchema.parse(delayStep());
    expect(parsed).not.toHaveProperty("templateName");
    expect(parsed.responseText).toBe("Segue a próxima etapa!");
  });
});

describe("followupStepsSchema: a cadeia inteira", () => {
  it("limita a 10 etapas", () => {
    const steps = Array.from({ length: 11 }, () => clickStep());
    expect(followupStepsSchema.safeParse(steps).success).toBe(false);
    expect(followupStepsSchema.safeParse(steps.slice(0, 10)).success).toBe(true);
  });
  it("recusa ids duplicados entre etapas", () => {
    const step = clickStep();
    expect(followupStepsSchema.safeParse([step, { ...delayStep(), id: step.id }]).success).toBe(false);
  });
});

describe("automationInputSchema: modo sequence exige etapas coerentes com o modo", () => {
  const base = { name: "Compra aprovada", eventType: "order.paid", productId: "p1", templateName: "purchase", templateLanguage: "pt_BR" };
  it("recusa modo sequence sem nenhuma etapa", () => {
    expect(automationInputSchema.safeParse({ ...base, followupMode: "sequence", followupSteps: [] }).success).toBe(false);
  });
  it("aceita modo sequence com ao menos uma etapa, seja por clique ou por atraso", () => {
    expect(automationInputSchema.safeParse({ ...base, followupMode: "sequence", followupSteps: [clickStep()] }).success).toBe(true);
    expect(automationInputSchema.safeParse({ ...base, followupMode: "sequence", followupSteps: [delayStep()] }).success).toBe(true);
  });
  it("recusa etapas fora do modo sequence", () => {
    expect(automationInputSchema.safeParse({ ...base, followupMode: "none", followupSteps: [clickStep()] }).success).toBe(false);
  });
});

describe("automation-chain: helpers puros de envio", () => {
  it("converte o atraso configurado para milissegundos por unidade", () => {
    expect(delayToMs({ ...delayStep(), trigger: { type: "delay", delayAmount: 2, delayUnit: "minutes" } })).toBe(120_000);
    expect(delayToMs({ ...delayStep(), trigger: { type: "delay", delayAmount: 1, delayUnit: "hours" } })).toBe(3_600_000);
    expect(delayToMs({ ...delayStep(), trigger: { type: "delay", delayAmount: 3, delayUnit: "days" } })).toBe(259_200_000);
  });
  it("recusa calcular atraso de uma etapa por clique", () => {
    expect(() => delayToMs(clickStep())).toThrow();
  });
  it("só embute botão na mensagem anterior quando a próxima etapa da cadeia é por clique", () => {
    const next = clickStep();
    expect(buildNextStepButtonComponent("automation-a", next)).toEqual({ type: "button", sub_type: "quick_reply", index: next.trigger.triggerButtonIndex, parameters: [{ type: "payload", payload: automationStepButtonPayload("automation-a", next.id) }] });
    expect(buildNextStepButtonComponent("automation-a", delayStep())).toBeNull();
    expect(buildNextStepButtonComponent("automation-a", null)).toBeNull();
  });
});
