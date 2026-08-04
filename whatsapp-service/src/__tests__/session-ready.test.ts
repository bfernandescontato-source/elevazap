import { describe, expect, it } from "vitest";
import { waitForSessionReady } from "../utils/session-ready.js";

describe("espera pela sessão do WhatsApp", () => {
  it("retorna imediatamente quando o QR já existe", async () => {
    const result = await waitForSessionReady(() => ({ status: "waiting_qr", qr: "data:image/png;base64,qr" }));
    expect(result.qr).toContain("data:image/png");
  });

  it("retorna imediatamente quando a sessão conectou", async () => {
    const result = await waitForSessionReady(() => ({ status: "connected", qr: "" }));
    expect(result.status).toBe("connected");
  });

  it("devolve o estado atual ao atingir o tempo limite", async () => {
    const result = await waitForSessionReady(() => ({ status: "starting", qr: "" }), 0);
    expect(result.status).toBe("starting");
  });
});
