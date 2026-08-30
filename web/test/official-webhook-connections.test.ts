import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ jobs: [] as Array<() => Promise<unknown>>, capture: vi.fn(), click: vi.fn(), status: vi.fn(), verify: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: (job: () => Promise<unknown>) => state.jobs.push(job) }));
vi.mock("@/modules/official-whatsapp/server/official-connections", () => ({
  listWebhookCredentials: async () => [
    { id: null, phoneNumberId: "111111", wabaId: "111112", appSecret: "legacy-secret" },
    { id: "account-b", phoneNumberId: "222222", wabaId: "222223", appSecret: "account-b-secret" }
  ],
  webhookVerifyTokenMatches: state.verify
}));
vi.mock("@/modules/official-whatsapp/server/hubla-events", () => ({ captureMetaButtonClick: state.capture }));
vi.mock("@/modules/official-whatsapp/server/flow-processor", () => ({ processButtonClickEvent: state.click }));
vi.mock("@/modules/official-whatsapp/server/messages-store", () => ({ applyMetaMessageStatus: state.status }));
import { GET, POST } from "../app/api/webhooks/meta/route";

function request(phone = "222222", waba = "222223", secret = "account-b-secret") {
  const body = JSON.stringify({ entry: [{ id: waba, changes: [{ value: { metadata: { phone_number_id: phone }, messages: [{ id: "click-id", type: "button", button: { payload: "confirm" }, from: "5511999999999" }], statuses: [{ id: "wamid.example", status: "delivered" }] } }] }] });
  return new NextRequest("https://example.com/api/webhooks/meta", { method: "POST", body, headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` } });
}
beforeEach(() => {
  vi.clearAllMocks(); state.jobs = [];
  state.capture.mockResolvedValue({ id: "event-id", duplicate: false });
  state.status.mockResolvedValue({ matched: true });
  state.verify.mockResolvedValue(false);
});
describe("webhooks isolados por conta oficial", () => {
  it("rejeita assinatura inválida antes de persistir", async () => {
    expect((await POST(request("222222", "222223", "wrong"))).status).toBe(401);
    expect(state.capture).not.toHaveBeenCalled();
  });
  it("uma assinatura válida não autoriza o número de outra conta", async () => {
    expect((await POST(request("111111", "111112"))).status).toBe(200);
    expect(state.capture).not.toHaveBeenCalled();
    expect(state.jobs).toHaveLength(0);
  });
  it("não usa conta principal como fallback para número desconhecido", async () => {
    await POST(request("999999", "222223"));
    expect(state.capture).not.toHaveBeenCalled();
    expect(state.jobs).toHaveLength(0);
  });
  it("encaminha clique e status com a identidade da conta autenticada", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(state.capture).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "account-b" }));
    for (const job of state.jobs) await job();
    expect(state.click).toHaveBeenCalledWith("event-id", expect.any(Object), "account-b");
    expect(state.status).toHaveBeenCalledWith(expect.objectContaining({ id: "wamid.example" }), "account-b");
  });
  it("preserva webhooks da conta principal", async () => {
    await POST(request("111111", "111112", "legacy-secret"));
    expect(state.capture).toHaveBeenCalledWith(expect.objectContaining({ connectionId: null }));
  });
  it("não reprocessa clique duplicado", async () => {
    state.capture.mockResolvedValue({ id: null, duplicate: true });
    await POST(request());
    for (const job of state.jobs) await job();
    expect(state.click).not.toHaveBeenCalled();
  });
  it("recusa handshake inválido e devolve somente o challenge autenticado", async () => {
    const url = "https://example.com/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=test&hub.challenge=123";
    expect((await GET(new NextRequest(url))).status).toBe(403);
    state.verify.mockResolvedValue(true);
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("123");
  });
});
