import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), template: vi.fn(), send: vi.fn(), log: vi.fn(), event: vi.fn() }));
vi.mock("../modules/official-whatsapp/server/automations", () => ({ findActiveAutomation: mocks.find }));
vi.mock("../modules/official-whatsapp/server/templates", () => ({ findTemplate: mocks.template }));
vi.mock("../modules/official-whatsapp/server/send-template", () => ({ sendWhatsAppTemplate: mocks.send }));
vi.mock("../modules/official-whatsapp/server/messages-store", () => ({ logMessageAttempt: mocks.log }));
vi.mock("../modules/official-whatsapp/server/hubla-events", () => ({ markEventStatus: mocks.event }));
import { processHublaEvent } from "../modules/official-whatsapp/server/hubla-processor";
const parsed = { eventType: "invoice.payment_succeeded", providerEventId: "purchase-1", productId: "product-1", productName: "Produto", customerName: "Maria", customerPhone: "5511999999999", customerEmail: null, amountCents: 100, paymentUrl: null, accessUrl: null };
const automation = { id: "automation-1", connection_id: "account-1", template_name: "purchase", template_language: "pt_BR", variable_mapping: { body: { "1": "first_name" } }, followup_mode: "button", followup_config: { triggerButtonIndex: "0", responseType: "text", responseText: "Obrigada {{first_name}}!" } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(structuredClone(automation));
  mocks.template.mockResolvedValue({ parameterFormat: "POSITIONAL", components: [{ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Ver detalhes" }] }] });
  mocks.send.mockResolvedValue({ phone: parsed.customerPhone, messageId: "wamid.initial", connectionId: "account-1", phoneNumberId: "123" });
  mocks.log.mockResolvedValue(undefined); mocks.event.mockResolvedValue(undefined);
});
it("compra envia apenas o modelo e guarda a segunda mensagem para o clique", async () => {
  await processHublaEvent("event-1", parsed);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "account-1", components: expect.arrayContaining([{ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "automation:automation-1:followup" }] }]) }));
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ automationId: "automation-1", automationSnapshot: expect.objectContaining({ mode: "button", context: expect.objectContaining({ productName: "Produto" }), config: expect.objectContaining({ responseText: "Obrigada {{first_name}}!" }) }) }));
});
it("mantém envio legado sem substituir o identificador antigo do botão", async () => {
  mocks.find.mockResolvedValue({ ...automation, followup_mode: "legacy", followup_config: null });
  await processHublaEvent("event-1", parsed);
  expect(mocks.send.mock.calls[0][0].components).toHaveLength(1);
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ automationSnapshot: null }));
});
it("não envia se o botão escolhido deixou de existir", async () => {
  mocks.template.mockResolvedValue({ parameterFormat: "POSITIONAL", components: [] });
  await processHublaEvent("event-1", parsed);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.event).toHaveBeenCalledWith("event-1", "failed", expect.any(String), { automationId: "automation-1" });
});

const clickStep = { id: "11111111-1111-1111-1111-111111111111", triggerType: "click" as const, triggerButtonIndex: "0", responseType: "text" as const, responseText: "Próxima etapa", caption: null, mediaBucket: null, mediaPath: null, mimeType: null, fileName: null, buttonConfig: null };
const delayStep = { id: "22222222-2222-2222-2222-222222222222", triggerType: "delay" as const, delayAmount: 30, delayUnit: "minutes" as const, templateName: "followup-template", templateLanguage: "pt_BR", variableMapping: {} };

it("sequência: primeira etapa por clique embute o botão e congela a etapa no snapshot v2", async () => {
  mocks.find.mockResolvedValue({ ...automation, followup_mode: "sequence", followup_config: null, followup_steps: [clickStep] });
  await processHublaEvent("event-1", parsed);
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ components: expect.arrayContaining([{ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "automation:automation-1:step:11111111-1111-1111-1111-111111111111" }] }]) }));
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ automationSnapshot: { version: 2, automationId: "automation-1", context: expect.objectContaining({ productName: "Produto" }), nextStep: clickStep } }));
});

it("sequência: primeira etapa por atraso não embute botão nenhum na mensagem inicial", async () => {
  mocks.find.mockResolvedValue({ ...automation, followup_mode: "sequence", followup_config: null, followup_steps: [delayStep] });
  await processHublaEvent("event-1", parsed);
  expect(mocks.send.mock.calls[0][0].components).toHaveLength(1);
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ automationSnapshot: { version: 2, automationId: "automation-1", context: expect.objectContaining({ productName: "Produto" }), nextStep: delayStep } }));
});

it("sequência: não envia se o botão da primeira etapa deixou de existir no modelo", async () => {
  mocks.template.mockResolvedValue({ parameterFormat: "POSITIONAL", components: [] });
  mocks.find.mockResolvedValue({ ...automation, followup_mode: "sequence", followup_config: null, followup_steps: [clickStep] });
  await processHublaEvent("event-1", parsed);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.event).toHaveBeenCalledWith("event-1", "failed", expect.any(String), { automationId: "automation-1" });
});
