import { describe, expect, it } from "vitest";
import { PilotMaintenanceWorker } from "../queue/pilot-maintenance.js";

// Banco simulado com a regra das funções claim/run/fail: o pedido só sai quando a reorganização
// termina; ocupado e erro deixam o pedido; o banco controla tentativas.
function fakeDb() {
  const pending = new Map<string, number>();       // automation -> pedidos
  const calls: string[] = [];
  const behaviour = new Map<string, "ok" | "busy" | "error">();
  let claimMissing = false;
  const rpc = async (name: string, params: any) => {
    calls.push(`${name}:${params.p_automation_id || ""}`);
    if (name === "claim_pilot_maintenance") {
      if (claimMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function claim_pilot_maintenance" } };
      return { data: Array.from(pending.keys()).slice(0, params.p_limit).map((id) => ({ automation_id: id, attempts: 1 })), error: null };
    }
    if (name === "run_pilot_maintenance") {
      const b = behaviour.get(params.p_automation_id) || "ok";
      if (b === "error") return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
      if (b === "busy") return { data: "ocupado", error: null };
      pending.delete(params.p_automation_id);
      return { data: "feita: promovidas 1", error: null };
    }
    return { data: null, error: null };
  };
  return { pending, calls, behaviour, rpc, setClaimMissing: (v: boolean) => { claimMissing = v; } };
}

describe("trabalhador da reorganização do Piloto", () => {
  it("reorganiza cada Piloto pendente em chamada própria", async () => {
    const db = fakeDb(); db.pending.set("p1", 1); db.pending.set("p2", 1);
    const w = new PilotMaintenanceWorker(db.rpc, "w1");
    expect(await w.runOnce()).toBe(2);
    expect(db.pending.size).toBe(0);
    expect(w.stats()).toMatchObject({ done: 2, busy: 0, failed: 0 });
  });

  it("Piloto ocupado: não espera, pedido continua e é feito depois", async () => {
    const db = fakeDb(); db.pending.set("p1", 1); db.behaviour.set("p1", "busy");
    const w = new PilotMaintenanceWorker(db.rpc, "w1");
    await w.runOnce();
    expect(db.pending.has("p1")).toBe(true);
    db.behaviour.set("p1", "ok");
    await w.runOnce();
    expect(db.pending.has("p1")).toBe(false);
    expect(w.stats()).toMatchObject({ busy: 1, done: 1 });
  });

  it("erro (tempo esgotado): registra o erro no banco, pedido continua, outros Pilotos seguem", async () => {
    const db = fakeDb(); db.pending.set("ruim", 1); db.pending.set("bom", 1); db.behaviour.set("ruim", "error");
    const w = new PilotMaintenanceWorker(db.rpc, "w1");
    await w.runOnce();
    expect(db.pending.has("ruim")).toBe(true);
    expect(db.pending.has("bom")).toBe(false);
    expect(db.calls).toContain("fail_pilot_maintenance:ruim");
    expect(w.stats().failed).toBe(1);
    expect(w.stats().lastError).toMatch(/statement timeout/);
  });

  it("banco sem as funções novas: desliga sem travar nada", async () => {
    const db = fakeDb(); db.setClaimMissing(true);
    const w = new PilotMaintenanceWorker(db.rpc, "w1");
    await expect(w.runOnce()).rejects.toThrow();
    expect(w.stats().available).toBe(false);
  });

  it("ciclo próprio: acorda com kick e para com stop", async () => {
    const db = fakeDb();
    let sleeps = 0;
    const w = new PilotMaintenanceWorker(db.rpc, "w1", { sleep: async () => { sleeps++; if (sleeps === 1) db.pending.set("p1", 1); if (sleeps > 3) w.stop(); } });
    w.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(db.pending.size).toBe(0);
    expect(w.stats().done).toBe(1);
  });
});
