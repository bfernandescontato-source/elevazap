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
