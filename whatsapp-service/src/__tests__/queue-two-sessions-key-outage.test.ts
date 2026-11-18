import { afterAll, describe, expect, it, vi } from "vitest";
import type { FakePostgrest } from "./helpers/fake-postgrest.js";

// Fila real (queue.ts) com dois números ao mesmo tempo. Cada número tem a leitura
// real de chaves (supabase-js -> PostgREST falso em 127.0.0.1) e cifra a mensagem
// com o Signal real do Baileys antes de "transmitir". A transmissão é o ponto em
// que o Baileys escreve no socket (sendNode): ali o WhatsApp já recebeu.
// O banco das filas (envios_grupo, RPCs) é simulado em memória.
const shared = vi.hoisted(() => {
  process.env.DB_TIMEOUT_MS = "1000";
  process.env.GLOBAL_SEND_THROTTLE_MS = "0";
  process.env.INSTANCE_ID = "teste-1";
  return {
    fake: null as unknown as FakePostgrest,
    jobs: new Map<string, any>(),
    completeScript: new Map<string, Array<"ok" | "timeout">>(),
    socks: new Map<string, any>(),
    transmissions: [] as Array<{ session: string; jid: string; type: string }>
  };
});

function jobsTable(table: string) {
  const state: { values?: any; filters: Array<[string, string, unknown]> } = { filters: [] };
  const matches = (job: any) => state.filters.every(([op, k, v]) => op === "eq" ? job[k] === v : job[k] !== v);
  const run = async () => {
    if (table === "accounts") return { data: { status: "active" }, error: null };
    if (table !== "envios_grupo") return { data: null, error: null };
    const job = [...shared.jobs.values()].find(matches);
    if (state.values) {
      if (job) Object.assign(job, state.values);
      return { data: null, error: null };
    }
    return { data: job ? { ...job } : null, error: null };
  };
  const chain: any = {
    update: (values: any) => { state.values = values; return chain; },
    select: () => chain,
    eq: (k: string, v: unknown) => { state.filters.push(["eq", k, v]); return chain; },
    neq: (k: string, v: unknown) => { state.filters.push(["neq", k, v]); return chain; },
    maybeSingle: run,
    then: (resolve: any, reject: any) => run().then(resolve, reject)
  };
  return chain;
}

vi.mock("../supabase.js", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { startFakePostgrest } = await import("./helpers/fake-postgrest.js");
  shared.fake = await startFakePostgrest();
  const real = createClient(shared.fake.url, "chave-de-teste", { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    supabase: {
      from: (table: string) => table.startsWith("whatsapp_auth_") ? real.from(table) : jobsTable(table),
      rpc: async (name: string, args: any) => {
        const job = shared.jobs.get(args?.p_message_id);
        if (name === "mark_whatsapp_job_sending") {
          return { data: job && job.status === "processando" && job.claim_token === args.p_claim_token ? { ...job } : null, error: null };
        }
        if (name === "validate_whatsapp_session_lease") return { data: true, error: null };
        if (name === "complete_whatsapp_job_sent") {
          if ((shared.completeScript.get(job.id)?.shift() ?? "ok") === "timeout") {
            return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
          }
          if (job.claim_token !== args.p_claim_token) return { data: false, error: null };
          Object.assign(job, { status: "sucesso", wa_message_id: args.p_wa_message_id, claim_token: null });
          return { data: true, error: null };
        }
        return { data: 0, error: null };
      }
    }
  };
});
vi.mock("../senders/runtime.js", () => ({
  getSenderSock: (name: string) => shared.socks.get(name) || null,
  getSenderSockById: () => null,
  getOwnedSenderLeases: () => []
}));
vi.mock("../queue/group-preparation.js", async (original) => ({
  ...(await original() as object),
  groupPreparation: { prepare: async () => ({ participants: [] }), cached: () => undefined, invalidate: () => undefined }
}));
vi.mock("../queue/policy.js", async (original) => ({ ...(await original() as object), queueSleep: async () => undefined }));

const { GlobalSendQueue } = await import("../queue/queue.js") as any;
const { useSupabaseAuthState } = await import("../auth/supabase-auth-state.js");
const { KEY_READ_POLICY } = await import("../auth/key-read-guard.js");
const baileys: any = await import("@whiskeysockets/baileys");
const { makeLibSignalRepository } = await import("@whiskeysockets/baileys/lib/Signal/libsignal.js" as any);
const { pino } = await import("pino");

Object.assign(KEY_READ_POLICY, { baseDelayMs: 50, budgetMs: 1_000, cooldownBaseMs: 300, cooldownMaxMs: 1_000 });
const silent = pino({ level: "silent" });
const CONTACT = "5511999990000@s.whatsapp.net";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Grava uma sessão Signal real com o contato, pelo próprio armazenamento do número. */
async function seedSignalSession(name: string) {
  const auth = await useSupabaseAuthState(name, "conta-teste");
  const keys = baileys.addTransactionCapability(auth.state.keys, silent, { maxCommitRetries: 1, delayBetweenTriesMs: 10 });
  const repo = makeLibSignalRepository({ creds: auth.state.creds, keys });
  const identity = baileys.Curve.generateKeyPair();
  const signed = baileys.signedKeyPair(identity, 1);
  const preKey = baileys.Curve.generateKeyPair();
  await keys.transaction(() => repo.injectE2ESession({ jid: CONTACT, session: {
    registrationId: 4321,
    identityKey: baileys.generateSignalPubKey(identity.public),
    signedPreKey: { keyId: 1, publicKey: baileys.generateSignalPubKey(signed.keyPair.public), signature: signed.signature },
    preKey: { keyId: 7, publicKey: baileys.generateSignalPubKey(preKey.public) }
  } }));
  return auth.state.creds;
}

/** Socket simulado na ordem do relayMessage: lê chaves e cifra; só então escreve (transmite). */
async function buildSock(name: string, creds: any) {
  const auth = await useSupabaseAuthState(name, "conta-teste");
  const keys = baileys.addTransactionCapability(auth.state.keys, silent, { maxCommitRetries: 1, delayBetweenTriesMs: 10 });
  const repo = makeLibSignalRepository({ creds, keys });
  let n = 0;
  const sock = {
    user: { id: `${name}:1@s.whatsapp.net` },
    end: vi.fn(),
    sendMessage: vi.fn(async (jid: string, message: any) => {
      let type = "";
      await keys.transaction(async () => {
        const encrypted = await repo.encryptMessage({ jid: CONTACT, data: Buffer.from(JSON.stringify(message)) });
        type = encrypted.type;
        shared.transmissions.push({ session: name, jid, type }); // = sendNode: o WhatsApp recebeu
      });
      return { key: { id: `WA-${name}-${++n}` } };
    })
  };
  shared.socks.set(name, sock);
  return sock;
}

let claimSeq = 0;
function addJob(id: string, session: string, group: string) {
  shared.jobs.set(id, { id, account_id: "conta-teste", whatsapp_session_id: `sid-${session}`, whatsapp_session_name: session,
    group_jid: group, tipo: "texto", texto: `oferta ${id}`, lote_id: null, status: "pendente", attempts: 0,
    claim_token: null, processing_worker_id: null, processing_lease_version: null, scheduled_at: new Date().toISOString() });
}
/** Igual ao claim do banco: só pega envio "pendente". Incerto e sucesso nunca voltam. */
function claimPending() {
  return [...shared.jobs.values()].filter((job) => job.status === "pendente").map((job) => {
    Object.assign(job, { status: "processando", claim_token: `ficha-${++claimSeq}`, processing_worker_id: "teste-1", processing_lease_version: 1 });
    return { id: job.id, kind: "grupo", account_id: job.account_id, whatsapp_session_id: job.whatsapp_session_id,
      claim_token: job.claim_token, lease_version: 1, attempt: job.attempts };
  });
}
function newQueue() {
  const q = new GlobalSendQueue({ envios: { stabilityColumns: true }, envios_grupo: { stabilityColumns: true } });
  q.maintenance.kick = () => undefined;
  q.cancelIfPilotDisabled = async () => false;
  q.cancelIfAmazonUnavailable = async () => false;
  q.syncOfferDelivery = async () => undefined;
  q.recalc = async () => undefined;
  return q;
}
const sentTo = (group: string) => shared.transmissions.filter((t) => t.jid === group).length;

afterAll(async () => { await shared.fake.close(); });

describe("fila com dois números: falha de chaves em A não afeta B nem duplica envio", () => {
  it("A falha antes de transmitir e volta para a fila; B envia; confirmação perdida fica incerta sem segundo envio", async () => {
    const credsA = await seedSignalSession("numero-a");
    const credsB = await seedSignalSession("numero-b");
    const sockA = await buildSock("numero-a", credsA);
    const sockB = await buildSock("numero-b", credsB);
    const GA = "120363000000000001@g.us", GB = "120363000000000002@g.us", GC = "120363000000000003@g.us";
    addJob("job-a", "numero-a", GA);
    addJob("job-b", "numero-b", GB);
    addJob("job-c", "numero-b", GC);
    shared.completeScript.set("job-c", ["timeout", "timeout", "timeout"]); // provedor aceitou, gravação da confirmação não
    shared.fake.setMode("numero-a", "521");
    const q = newQueue();

    // Rodada 1: os três ao mesmo tempo. A está com o banco de chaves fora (521).
    await Promise.all(claimPending().map((item) => q.process(item)));

    const a = shared.jobs.get("job-a"), b = shared.jobs.get("job-b"), c = shared.jobs.get("job-c");
    expect(a).toMatchObject({ status: "pendente", last_error_code: "AUTH_KEYS_UNAVAILABLE", attempts: 0 });
    expect(a.reconciliation_required).toBeUndefined();
    expect(b).toMatchObject({ status: "sucesso", wa_message_id: "WA-numero-b-1" });
    expect(c).toMatchObject({ status: "incerto", last_error_code: "PERSIST_SUCCESS_FAILED", reconciliation_required: true });
    expect(c.wa_message_id).toMatch(/^WA-numero-b-/);
    expect(sentTo(GA)).toBe(0);
    expect(sentTo(GB)).toBe(1);
    expect(sentTo(GC)).toBe(1);
    expect(shared.transmissions.filter((t) => t.session === "numero-b").every((t) => t.type === "pkmsg")).toBe(true);
    expect(sockA.end).not.toHaveBeenCalled(); // a fila não derrubou o socket; a recuperação é da sessão
    expect(shared.fake.destructive()).toHaveLength(0);

    // Rodada 2: banco volta; passa a espera do número A. Só o "pendente" é pego de novo.
    shared.fake.setMode("numero-a", "ok");
    await sleep(KEY_READ_POLICY.cooldownBaseMs + 100);
    const second = claimPending();
    expect(second.map((item) => item.id)).toEqual(["job-a"]);
    await Promise.all(second.map((item) => q.process(item)));

    // Rodada 3: nada mais a pegar.
    expect(claimPending()).toEqual([]);

    expect(shared.jobs.get("job-a")).toMatchObject({ status: "sucesso" });
    expect(shared.jobs.get("job-c")).toMatchObject({ status: "incerto" });
    expect({ GA: sentTo(GA), GB: sentTo(GB), GC: sentTo(GC) }).toEqual({ GA: 1, GB: 1, GC: 1 });
    expect(sockA.sendMessage).toHaveBeenCalledTimes(2); // 1ª parou antes de transmitir; 2ª transmitiu
    expect(sockB.sendMessage).toHaveBeenCalledTimes(2);
    console.info({ event: "teste.tentativas_por_destino", chamadas_sendMessage: { A: sockA.sendMessage.mock.calls.length, B: sockB.sendMessage.mock.calls.length },
      transmissoes: { GA: sentTo(GA), GB: sentTo(GB), GC: sentTo(GC) }, leituras_de_chave_A: shared.fake.keyReads("numero-a").map((r) => r.mode) });
  });
});
