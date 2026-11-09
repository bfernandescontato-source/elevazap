import { describe, expect, it, vi } from "vitest";
import { STATUS_AUDIENCE_GROUPS_MAX, STATUS_JID, buildStatusAudience, buildStatusMessage, isStatusJob, prepareStatusAudience, statusAudienceGroups } from "../queue/status-post.js";

const runtime = vi.hoisted(() => ({ sock: null as any }));
vi.mock("../supabase.js", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("../senders/runtime.js", () => ({ getSenderSock: vi.fn(() => runtime.sock), getSenderSockById: vi.fn(() => runtime.sock), getOwnedSenderLeases: vi.fn(() => []) }));
vi.mock("../utils/media.js", async (orig) => ({ ...(await orig() as object), downloadMedia: vi.fn(async () => Buffer.from("jpeg-do-story")) }));

function socket() {
  return {
    user: { id: "5511900000000:7@s.whatsapp.net" },
    groupMetadata: vi.fn(async (jid: string) => jid === "1@g.us"
      ? { participants: [{ id: "100@lid", jid: "5511911111111@s.whatsapp.net" }, { id: "5511922222222@s.whatsapp.net", jid: "5511922222222@s.whatsapp.net" }, { id: "5511900000000@s.whatsapp.net" }] }
      : { participants: [{ id: "5511922222222@s.whatsapp.net" }, { id: "300@lid", jid: "" }, { id: "5511933333333@s.whatsapp.net" }] }),
    getUSyncDevices: vi.fn(async (jids: string[]) => jids.map((jid) => ({ user: jid.split("@")[0], device: 0 }))),
    assertSessions: vi.fn(async () => true),
    authState: { keys: { get: vi.fn(async () => ({})), transaction: async (work: () => Promise<unknown>) => work() } },
    sendMessage: vi.fn(async () => ({ key: { id: "WA-STATUS-1" } })),
    end: vi.fn()
  };
}

describe("status: público e mensagem", () => {
  it("reconhece só o destino do Status", () => {
    expect(isStatusJob({ group_jid: STATUS_JID })).toBe(true);
    expect(isStatusJob({ group_jid: "123@g.us" })).toBe(false);
    expect(isStatusJob(null)).toBe(false);
  });

  it("usa só grupos válidos, sem repetição e no máximo 5", () => {
    const jids = ["1@g.us", "1@g.us", "x@s.whatsapp.net", 42, "2@g.us", "3@g.us", "4@g.us", "5@g.us", "6@g.us"];
    expect(statusAudienceGroups({ status_audience_jids: jids })).toEqual(["1@g.us", "2@g.us", "3@g.us", "4@g.us", "5@g.us"]);
    expect(statusAudienceGroups({ status_audience_jids: null })).toEqual([]);
    expect(STATUS_AUDIENCE_GROUPS_MAX).toBe(5);
  });

  it("monta o público por telefone, sem repetir, sem @lid, com o próprio número primeiro", () => {
    const audience = buildStatusAudience([
      { participants: [{ id: "100@lid", jid: "5511911111111@s.whatsapp.net" }, { id: "5511900000000@s.whatsapp.net" }] },
      { participants: [{ id: "5511911111111@s.whatsapp.net" }, { id: "200@lid" }, { id: "5511933333333:3@s.whatsapp.net" }] }
    ], "5511900000000:7@s.whatsapp.net");
    expect(audience).toEqual(["5511900000000@s.whatsapp.net", "5511911111111@s.whatsapp.net", "5511933333333@s.whatsapp.net"]);
  });

  it("limita o tamanho do público", () => {
    const participants = Array.from({ length: 50 }, (_, i) => ({ id: `55119${String(i).padStart(8, "0")}@s.whatsapp.net` }));
    const audience = buildStatusAudience([{ participants }], "5511900000000@s.whatsapp.net", 10);
    expect(audience).toHaveLength(11);
    expect(audience[0]).toBe("5511900000000@s.whatsapp.net");
  });

  it("leva a mensagem da oferta com o link na legenda da imagem", () => {
    const media = Buffer.from("x");
    expect(buildStatusMessage({ legenda: "Oferta https://s.shopee.com.br/abc" }, media)).toEqual({ image: media, caption: "Oferta https://s.shopee.com.br/abc" });
    expect(buildStatusMessage({ legenda: "  " }, media)).toEqual({ image: media });
  });

  it("prepara aparelhos e sessões do público sem enviar nada", async () => {
    const sock = socket();
    const audience = await prepareStatusAudience(sock, ["1@g.us", "2@g.us"]);
    expect(audience).toEqual(["5511900000000@s.whatsapp.net", "5511911111111@s.whatsapp.net", "5511922222222@s.whatsapp.net", "5511933333333@s.whatsapp.net"]);
    expect(sock.getUSyncDevices).toHaveBeenCalledWith(audience, true, false);
    expect(sock.assertSessions).toHaveBeenCalledWith(audience, false);
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });
});

describe("status: envio pela fila normal", () => {
  const baseRow = () => ({
    id: "job-status", account_id: "account-1", lote_id: "lote-1", whatsapp_session_id: "sess-1", whatsapp_session_name: "numero-1",
    group_jid: STATUS_JID, tipo: "imagem", legenda: "Achado! https://s.shopee.com.br/abc", media_bucket: "whatsapp-media",
    media_path: "accounts/account-1/stories/a.jpg", status_audience_jids: ["1@g.us", "2@g.us"], claim_token: "ficha", processing_lease_version: 1,
    scheduled_at: new Date().toISOString()
  });

  async function queue() {
    const { GlobalSendQueue } = await import("../queue/queue.js") as any;
    const q = new GlobalSendQueue({ envios: { stabilityColumns: true }, envios_grupo: { stabilityColumns: true } });
    q.authorizeRelay = vi.fn(async () => undefined);
    q.persistSuccess = vi.fn(async () => undefined);
    return q;
  }

  it("envia para status@broadcast com a lista de quem vê e confirma como envio de grupo", async () => {
    runtime.sock = socket();
    const q = await queue();
    const row = baseRow();
    await q.sendGroup(row, new AbortController().signal);
    expect(runtime.sock.sendMessage).toHaveBeenCalledTimes(1);
    const [jid, message, options] = runtime.sock.sendMessage.mock.calls[0];
    expect(jid).toBe(STATUS_JID);
    expect(message).toEqual({ image: Buffer.from("jpeg-do-story"), caption: "Achado! https://s.shopee.com.br/abc" });
    expect(options.statusJidList[0]).toBe("5511900000000@s.whatsapp.net");
    expect(options.statusJidList).toHaveLength(4);
    expect(runtime.sock.groupMetadata).not.toHaveBeenCalledWith(STATUS_JID);
    expect(q.authorizeRelay).toHaveBeenCalledWith("envios_grupo", row, expect.anything());
    expect(q.persistSuccess).toHaveBeenCalledWith("envios_grupo", row, "WA-STATUS-1");
  });

  it("falha antes de transmitir quando não há público ou imagem", async () => {
    runtime.sock = socket();
    runtime.sock.groupMetadata = vi.fn(async () => ({ participants: [{ id: "9@lid" }] }));
    const q = await queue();
    const row: any = baseRow();
    await expect(q.sendGroup(row, new AbortController().signal)).rejects.toThrow(/Nenhum contato/);
    expect(row.send_started).toBeUndefined();
    await expect(q.sendGroup({ ...baseRow(), media_path: null }, new AbortController().signal)).rejects.toThrow(/sem imagem/);
    await expect(q.sendGroup({ ...baseRow(), status_audience_jids: [] }, new AbortController().signal)).rejects.toThrow(/sem grupos/);
    expect(runtime.sock.sendMessage).not.toHaveBeenCalled();
  });
});
