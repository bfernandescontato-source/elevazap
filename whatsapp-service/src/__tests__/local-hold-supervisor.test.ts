import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Arquivo de espera antes de carregar o módulo (LOCAL_HOLD_FILE é lido na importação).
const holdFile = join(mkdtempSync(join(tmpdir(), "hold-sup-")), "sessions");
process.env.LOCAL_HOLD_FILE = holdFile;

const calls: string[] = [];
const created: string[] = [];
const stopped: string[] = [];
const senderRows = [
  { id: "id-livre", session_name: "sender_livre", label: "Livre", account_id: "acc" },
  { id: "id-preso", session_name: "sender_preso", label: "Preso", account_id: "acc" }
];

vi.mock("../supabase.js", () => ({
  supabase: {
    rpc: vi.fn(async (name: string) => {
      calls.push(`rpc:${name}`);
      if (name === "acquire_whatsapp_session_leases") return { data: senderRows.map((s) => ({ whatsapp_session_id: s.id, account_id: "acc", lease_version: 1 })), error: null };
      return { data: [], error: null };
    }),
    from: vi.fn(() => ({ select: () => ({ in: async () => ({ data: senderRows, error: null }) }) }))
  }
}));
vi.mock("../whatsapp/session.js", () => ({
  createWhatsAppSession: vi.fn(async (sessionName: string) => {
    created.push(sessionName);
    return { sessionId: sessionName, instanceId: "x", sock: null, getStatus: () => "connected", getQr: () => "", getLastError: () => null,
      logout: async () => undefined, stop: async () => { stopped.push(sessionName); } };
  })
}));
vi.mock("../offers/whatsapp-monitor.js", () => ({ monitorOfferMessages: vi.fn() }));
vi.mock("../groups/events.js", () => ({ scheduleParticipantEventSync: vi.fn() }));

const runtime = await import("../senders/runtime.js");

describe("espera local respeitada pelo supervisor (funcional, com banco simulado)", () => {
  beforeEach(() => { calls.length = 0; created.length = 0; stopped.length = 0; });

  it("número em espera nunca é conectado; o livre é", async () => {
    writeFileSync(holdFile, "sender_preso\n");
    await runtime.syncSenderSessionOwnership();
    expect(created).toEqual(["sender_livre"]);
  });

  it("número que entra em espera é parado ANTES de qualquer chamada ao banco", async () => {
    writeFileSync(holdFile, "");
    await runtime.syncSenderSessionOwnership();          // sobe os dois
    expect(created).toContain("sender_preso");
    calls.length = 0; stopped.length = 0;
    writeFileSync(holdFile, "sender_preso\n");
    const { utimesSync } = await import("node:fs");
    utimesSync(holdFile, new Date(), new Date(Date.now() + 10_000));
    // banco "fora": a primeira chamada ao banco falha
    const { supabase } = await import("../supabase.js");
    (supabase.rpc as any).mockImplementationOnce(async () => { calls.push("rpc:falhou"); throw new Error("banco fora"); });
    await expect(runtime.syncSenderSessionOwnership()).rejects.toThrow("banco fora");
    expect(stopped).toEqual(["sender_preso"]);
    expect(calls).toEqual(["rpc:falhou"]);
  });

  it("start manual pela API também respeita a espera", async () => {
    writeFileSync(holdFile, "sender_preso\n");
    const { utimesSync } = await import("node:fs");
    utimesSync(holdFile, new Date(), new Date(Date.now() + 20_000));
    created.length = 0;
    const { supabase } = await import("../supabase.js");
    (supabase.from as any).mockImplementationOnce(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: senderRows[1] }) }) }) }));
    (supabase.rpc as any).mockImplementationOnce(async () => ({ data: [{ whatsapp_session_id: "id-preso", account_id: "acc", lease_version: 9 }], error: null }));
    await expect(runtime.restartSenderSessionByName("sender_preso")).rejects.toThrow(/espera local/);
    expect(created).toEqual([]);
  });
});
