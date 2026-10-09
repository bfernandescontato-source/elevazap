import { describe, expect, it } from "vitest";
import { confirmSent, isTransientDbError } from "../queue/confirm-sent.js";
import { OperationTimeoutError } from "../utils/timeout.js";

// Banco simulado com a mesma regra de complete_whatsapp_job_sent: só grava com a ficha válida e
// limpa a ficha ao gravar. Cada tentativa pode: gravar e responder, gravar e perder a resposta,
// ou não gravar (tempo esgotado / falha temporária).
type Step = "ok" | "commit_then_lose_response" | "timeout_no_commit" | "network_no_commit" | "permanent";

function fakeDb(steps: Step[], initial: { status: string; claim: string | null; wa: string | null } = { status: "processando", claim: "ficha", wa: null }) {
  const row = { ...initial };
  const calls = { complete: 0, readBack: 0, sends: 0 };
  const dbError = (code: string) => Object.assign(new Error(code), { code });
  return {
    row, calls,
    deps: {
      complete: async () => {
        const step = steps[calls.complete++] ?? "ok";
        if (step === "timeout_no_commit") throw dbError("57014");
        if (step === "network_no_commit") throw dbError("DATABASE_ERROR");
        if (step === "permanent") throw dbError("42501");
        if (row.claim !== "ficha") return false;
        row.status = "sucesso"; row.wa = "WA-1"; row.claim = null;
        if (step === "commit_then_lose_response") throw new OperationTimeoutError("queue.persist-success", 10_000);
        return true;
      },
      readBack: async () => { calls.readBack++; return { status: row.status, wa_message_id: row.wa }; },
      sleep: async () => undefined
    }
  };
}

describe("confirmação de mensagem já aceita pelo WhatsApp", () => {
  it("caso normal: grava na primeira", async () => {
    const db = fakeDb(["ok"]);
    expect(await confirmSent("WA-1", db.deps)).toEqual({ state: "confirmed", attempts: 1 });
    expect(db.row).toMatchObject({ status: "sucesso", wa: "WA-1" });
  });

  it("falha temporária do banco (tempo esgotado): repete só a gravação e confirma", async () => {
    const db = fakeDb(["timeout_no_commit", "ok"]);
    expect(await confirmSent("WA-1", db.deps)).toEqual({ state: "confirmed", attempts: 2 });
    expect(db.calls.complete).toBe(2);
    expect(db.row.status).toBe("sucesso");
  });

  it("falha de conexão duas vezes e depois grava", async () => {
    const db = fakeDb(["network_no_commit", "network_no_commit", "ok"]);
    expect((await confirmSent("WA-1", db.deps)).state).toBe("confirmed");
    expect(db.calls.complete).toBe(3);
  });

  it("confirmação atrasada: o banco gravou mas a resposta se perdeu; reconhece sem gravar de novo", async () => {
    const db = fakeDb(["commit_then_lose_response"]);
    expect(await confirmSent("WA-1", db.deps)).toEqual({ state: "already_confirmed", attempts: 1 });
    expect(db.calls.complete).toBe(1);
  });

  it("repetir a mesma confirmação não duplica nem desfaz", async () => {
    const db = fakeDb(["ok", "ok"]);
    await confirmSent("WA-1", db.deps);
    const again = await confirmSent("WA-1", db.deps);
    expect(again.state).toBe("already_confirmed");
    expect(db.row).toMatchObject({ status: "sucesso", wa: "WA-1", claim: null });
  });

  it("tempo esgotado em todas as tentativas: continua incerto, com a causa", async () => {
    const db = fakeDb(["timeout_no_commit", "timeout_no_commit", "timeout_no_commit"]);
    const outcome = await confirmSent("WA-1", db.deps);
    expect(outcome.state).toBe("unconfirmed");
    expect((outcome as any).cause.code).toBe("57014");
    expect(db.calls.complete).toBe(3);
    expect(db.row.status).toBe("processando");
  });

  it("erro permanente não é repetido", async () => {
    const db = fakeDb(["permanent", "ok"]);
    expect((await confirmSent("WA-1", db.deps)).state).toBe("unconfirmed");
    expect(db.calls.complete).toBe(1);
  });

  it("reinício entre envio e gravação: o envio foi marcado incerto pelo reinício; não vira sucesso", async () => {
    const db = fakeDb(["ok"], { status: "incerto", claim: null, wa: null });
    const outcome = await confirmSent("WA-1", db.deps);
    expect(outcome.state).toBe("unconfirmed");
    expect(db.row.status).toBe("incerto");
  });

  it("ficha perdida (outro trabalhador): não repete e não assume sucesso", async () => {
    const db = fakeDb(["ok", "ok"], { status: "processando", claim: "outra", wa: null });
    expect((await confirmSent("WA-1", db.deps)).state).toBe("unconfirmed");
    expect(db.calls.complete).toBe(1);
  });

  it("sucesso salvo com OUTRO identificador não comprova esta mensagem", async () => {
    const db = fakeDb(["ok"], { status: "sucesso", claim: null, wa: "WA-OUTRA" });
    expect((await confirmSent("WA-1", db.deps)).state).toBe("unconfirmed");
  });

  it("nunca reenvia: as dependências não têm envio, só gravar e reler", async () => {
    const db = fakeDb(["timeout_no_commit", "timeout_no_commit", "ok"]);
    await confirmSent("WA-1", db.deps);
    expect(Object.keys(db.deps).sort()).toEqual(["complete", "readBack", "sleep"]);
    expect(db.calls.sends).toBe(0);
  });

  it("classifica erros temporários", () => {
    expect(isTransientDbError(Object.assign(new Error(), { code: "57014" }))).toBe(true);
    expect(isTransientDbError(Object.assign(new Error(), { code: "08006" }))).toBe(true);
    expect(isTransientDbError(new OperationTimeoutError("x", 1))).toBe(true);
    expect(isTransientDbError(Object.assign(new Error(), { code: "42501" }))).toBe(false);
    expect(isTransientDbError(Object.assign(new Error(), { code: "PGRST202" }))).toBe(false);
  });
});
