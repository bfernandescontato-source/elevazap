import { beforeEach, describe, expect, it, vi } from "vitest";

// Fila real (queue.ts) com banco simulado: o envio ao WhatsApp já aconteceu; aqui só se observa
// o que a fila grava depois. Banco segue a regra de complete_whatsapp_job_sent (ficha limpa ao gravar).
const db = {
  row: { id: "job-1", status: "processando", claim_token: "ficha", wa_message_id: null as string | null },
  completeSteps: [] as Array<"ok" | "timeout" | "commit_lost">,
  rpcCalls: [] as string[],
  updates: [] as Array<{ table: string; values: any; filters: string[] }>,
  failRecalc: false,
  leaseVersion: 1
};

function builder(table: string) {
  const state: { values?: any; filters: string[] } = { filters: [] };
  const run = async () => {
    if (state.values) {
      db.updates.push({ table, values: state.values, filters: state.filters });
      const tokenFilter = state.filters.find((f) => f.startsWith("eq:claim_token="));
      const blocked = (state.filters.includes("neq:status=sucesso") && db.row.status === "sucesso")
        || (tokenFilter !== undefined && tokenFilter !== `eq:claim_token=${db.row.claim_token}`);
      if (!blocked && table === "envios_grupo") Object.assign(db.row, { status: state.values.status ?? db.row.status });
      return { data: null, error: null };
    }
    return { data: { status: db.row.status, wa_message_id: db.row.wa_message_id }, error: null };
  };
  const chain: any = {
    update: (values: any) => { state.values = values; return chain; },
    select: () => chain,
    eq: (k: string, v: unknown) => { state.filters.push(`eq:${k}=${v}`); return chain; },
    neq: (k: string, v: unknown) => { state.filters.push(`neq:${k}=${v}`); return chain; },
    maybeSingle: run,
    then: (resolve: any, reject: any) => run().then(resolve, reject)
  };
  return chain;
}

vi.mock("../supabase.js", () => ({
  supabase: {
    rpc: vi.fn(async (name: string) => {
      db.rpcCalls.push(name);
      if (name === "complete_whatsapp_job_sent") {
        const step = db.completeSteps.shift() ?? "ok";
        if (step === "timeout") return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
        if (db.row.claim_token !== "ficha" || db.leaseVersion !== 1) return { data: false, error: null };
        Object.assign(db.row, { status: "sucesso", wa_message_id: "WA-1", claim_token: null });
        if (step === "commit_lost") return { data: null, error: { code: "DATABASE_ERROR", message: "fetch failed" } };
        return { data: true, error: null };
      }
      if (name === "recalc_lote_counts" && db.failRecalc) return { data: null, error: { code: "57014", message: "timeout" } };
      return { data: 0, error: null };
    }),
    from: vi.fn((table: string) => builder(table))
  }
}));
vi.mock("../senders/runtime.js", () => ({ getSenderSock: vi.fn(), getSenderSockById: vi.fn() }));
vi.mock("../queue/policy.js", async (orig) => ({ ...(await orig() as object), queueSleep: async () => undefined }));

const { GlobalSendQueue } = await import("../queue/queue.js") as any;

const kicks = { n: 0 };
function newQueue() {
  const q = new GlobalSendQueue({ envios: { stabilityColumns: true }, envios_grupo: { stabilityColumns: true } });
  q.maintenance.kick = () => { kicks.n++; };
  return q;
}
const job = { id: "job-1", lote_id: "lote-1", claim_token: "ficha", processing_lease_version: 1 };

describe("fila: gravação da confirmação de mensagem já aceita", () => {
  beforeEach(() => {
    Object.assign(db.row, { status: "processando", claim_token: "ficha", wa_message_id: null });
    db.completeSteps = []; db.rpcCalls = []; db.updates = []; db.failRecalc = false; db.leaseVersion = 1;
  });

  it("tempo esgotado na primeira gravação: repete só a gravação, fica sucesso, acorda a reorganização", async () => {
    db.completeSteps = ["timeout", "ok"];
    kicks.n = 0;
    const q = newQueue();
    await q.persistSuccess("envios_grupo", job, "WA-1");
    expect(db.rpcCalls.filter((n) => n.startsWith("complete_"))).toEqual(["complete_whatsapp_job_sent", "complete_whatsapp_job_sent"]);
    expect(db.row.status).toBe("sucesso");
    expect(db.updates.some((u) => u.values.status === "incerto")).toBe(false);
    expect(kicks.n).toBe(1);
    expect(q.stats().confirmation).toEqual({ retried: 1, alreadySaved: 0, notSaved: 0 });
  });

  it("gravou mas a resposta se perdeu: reconhece o sucesso, não marca incerto", async () => {
    db.completeSteps = ["commit_lost"];
    await newQueue().persistSuccess("envios_grupo", job, "WA-1");
    expect(db.row.status).toBe("sucesso");
    expect(db.updates.some((u) => u.values.status === "incerto")).toBe(false);
  });

  it("falha depois da confirmação salva (recálculo do lote) não transforma sucesso em incerto", async () => {
    db.failRecalc = true;
    await newQueue().persistSuccess("envios_grupo", job, "WA-1");
    expect(db.row.status).toBe("sucesso");
    expect(db.updates.some((u) => u.values.status === "incerto")).toBe(false);
  });

  it("três tempos esgotados: fica incerto com o identificador, e a marcação nunca sobrescreve sucesso", async () => {
    db.completeSteps = ["timeout", "timeout", "timeout"];
    await newQueue().persistSuccess("envios_grupo", job, "WA-1");
    const mark = db.updates.find((u) => u.values.status === "incerto")!;
    expect(mark.values).toMatchObject({ last_error_code: "PERSIST_SUCCESS_FAILED", wa_message_id: "WA-1", reconciliation_required: true });
    expect(mark.filters).toContain("neq:status=sucesso");
    expect(mark.filters).toContain("eq:claim_token=ficha");
    expect(db.row.status).toBe("incerto");
  });

  it("trabalhador antigo (lease trocado): não grava sucesso e a marcação só vale com a própria ficha", async () => {
    db.leaseVersion = 2;                       // outro trabalhador assumiu o número
    db.row.claim_token = "ficha-nova";         // e o envio foi reivindicado de novo
    await newQueue().persistSuccess("envios_grupo", job, "WA-1");
    expect(db.row.status).toBe("processando"); // não virou sucesso nem foi sobrescrito
    const mark = db.updates.find((u) => u.values.status === "incerto")!;
    expect(mark.filters).toContain("eq:claim_token=ficha"); // no banco real, a ficha diferente não casa
  });
});
