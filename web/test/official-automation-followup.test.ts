import { beforeEach, describe, expect, it, vi } from "vitest";
import { automationButtonPayload, automationInputSchema, followupConfigSchema } from "../modules/official-whatsapp/automation-config";
const state = vi.hoisted(() => ({ original: null as any, claimed: false, send: vi.fn(), log: vi.fn(), event: vi.fn(), updates: [] as any[] }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: () => ({ from: () => {
  let updating = false; let values: any; let claim = false;
  const q: any = { select: () => q, eq: (key: string, value: any) => { if (key === "automation_reply_state" && value === "waiting") claim = true; return q; }, update: (value: any) => { updating = true; values = value; state.updates.push(value); return q; }, maybeSingle: async () => {
    if (!updating) return { data: state.original, error: null };
    if (claim) { if (state.claimed) return { data: null }; state.claimed = true; return { data: { id: "message-id" } }; }
    return { data: null, error: null };
  }, then: (resolve: any) => Promise.resolve({ error: null }).then(resolve) }; return q;
} }) }));
vi.mock("../modules/official-whatsapp/server/send-interactive", () => ({ sendQuickReplyMessage: state.send }));
vi.mock("../modules/official-whatsapp/server/messages-store", () => ({ logMessageAttempt: state.log }));
vi.mock("../modules/official-whatsapp/server/hubla-events", () => ({ markEventStatus: state.event }));
vi.mock("../modules/official-whatsapp/server/meta-media", () => ({ uploadMediaFromStorage: vi.fn() }));
import { isAutomationReplyMatch, processAutomationButtonClick, type AutomationSnapshot } from "../modules/official-whatsapp/server/automation-followup";

const context = { customerName: "Maria Silva", customerPhone: "5511999999999", customerEmail: "maria@example.com", productName: "Produto original", amountCents: 1000, accessUrl: "https://example.com/acesso", paymentUrl: null };
const config = followupConfigSchema.parse({ triggerButtonIndex: "0", responseType: "text", responseText: "Olá {{first_name}}, seu {{product_name}} está pronto!", buttonConfig: { type: "url", text: "ACESSAR", url: "https://example.com" } });
const snapshot: AutomationSnapshot = { version: 1, mode: "button", context, config, triggerPayload: automationButtonPayload("product-a") };
const click = { from: "5511999999999", button: { payload: snapshot.triggerPayload! }, context: { id: "wamid.original" } };
beforeEach(() => {
  vi.clearAllMocks(); state.claimed = false; state.updates = [];
  state.original = { id: "message-id", phone: click.from, connection_id: null, automation_id: "product-a", automation_snapshot: structuredClone(snapshot), automation_reply_state: "waiting" };
  state.send.mockResolvedValue({ phone: click.from, phoneNumberId: "12345", messageId: "wamid.reply", response: {}, requestPayload: {} });
  state.log.mockResolvedValue({ id: "log" }); state.event.mockResolvedValue(undefined);
});
describe("automação completa: configuração", () => {
  const input = { name: "Compra aprovada", eventType: "invoice.payment_succeeded", productId: "p1", templateName: "purchase", templateLanguage: "pt_BR", followupMode: "button", followupConfig: config };
  it("exige a mensagem seguinte quando o gatilho é clique", () => {
    expect(automationInputSchema.safeParse(input).success).toBe(true);
    expect(automationInputSchema.safeParse({ ...input, followupConfig: null }).success).toBe(false);
  });
  it("recusa links inseguros, texto vazio e áudio com botão", () => {
    expect(followupConfigSchema.safeParse({ ...config, buttonConfig: { ...config.buttonConfig, url: "javascript:alert(1)" } }).success).toBe(false);
    expect(followupConfigSchema.safeParse({ ...config, responseText: null }).success).toBe(false);
    expect(followupConfigSchema.safeParse({ ...config, responseType: "audio" }).success).toBe(false);
  });
  it("permite encerrar na primeira mensagem explicitamente", () => {
    expect(automationInputSchema.safeParse({ ...input, followupMode: "none", followupConfig: null }).success).toBe(true);
  });
  it("identificadores não colidem entre produtos", () => {
    expect(automationButtonPayload("product-a")).not.toBe(automationButtonPayload("product-b"));
  });
});
describe("segunda mensagem isolada e idempotente", () => {
  it("usa o conteúdo e os dados da compra original, sem consultar ação global", async () => {
    expect(await processAutomationButtonClick("event", click, null)).toBe(true);
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ response_type: "text" }), click.from, expect.objectContaining({ text: "Olá Maria, seu Produto original está pronto!" }), undefined, null);
    expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ automationId: "product-a" }));
  });
  it("dois cliques simultâneos geram apenas uma resposta", async () => {
    await Promise.all([processAutomationButtonClick("e1", click, null), processAutomationButtonClick("e2", click, null)]);
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it("não troca produto, conta nem destinatário", async () => {
    expect(isAutomationReplyMatch(snapshot, click.from, "another-account", state.original, click.button.payload)).toBe(false);
    expect(isAutomationReplyMatch(snapshot, "5511888888888", null, state.original, click.button.payload)).toBe(false);
    await processAutomationButtonClick("event", { ...click, button: { payload: automationButtonPayload("product-b") } }, null);
    expect(state.send).not.toHaveBeenCalled();
  });
  it("não recorre a resposta global se a automação encerra na primeira mensagem", async () => {
    state.original.automation_snapshot.mode = "none";
    expect(await processAutomationButtonClick("event", click, null)).toBe(true);
    expect(state.send).not.toHaveBeenCalled();
  });
  it("preserva o caminho legado quando não existe configuração própria", async () => {
    state.original.automation_snapshot = null;
    expect(await processAutomationButtonClick("event", { ...click, button: { payload: "Ver detalhes" } }, null)).toBe(false);
  });
  it("não reenvia depois de falha ao registrar um envio já aceito", async () => {
    state.log.mockRejectedValue(new Error("database unavailable"));
    await processAutomationButtonClick("e1", click, null);
    await processAutomationButtonClick("e2", click, null);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.updates).toContainEqual({ automation_reply_state: "sent" });
  });
});
