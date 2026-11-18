// Simula, num processo Node de verdade, a queda de 18/11/2026: o banco de chaves
// responde 521 (página da Cloudflare) para o número A enquanto o número B envia.
// Usa o código compilado (dist) e o Baileys da imagem; nenhum acesso à rede:
// o "Supabase" é um servidor HTTP local. Rode só em container isolado:
//   docker run --rm --network none -v $PWD/simular-falha-chaves.mjs:/sim/s.mjs:ro \
//     --entrypoint node <imagem> /sim/s.mjs
// FALHA_MS: quanto tempo o banco fica fora para o número A (padrão 2500: volta
// dentro das tentativas; 6000: esgota as tentativas e A entra em recuperação).
// Saída: uma linha JSON por evento e o resumo final. Código de saída 0 = processo vivo até o fim.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";

const APP = process.env.APP_DIR || "/app";
const DIST = `${APP}/whatsapp-service/dist`;
const T0 = Date.now();
const log = (event, fields = {}) => console.log(JSON.stringify({ t_ms: Date.now() - T0, event, ...fields }));

const CLOUDFLARE_521 = "<!DOCTYPE html><html><head><title>supabase.co | 521: Web server is down</title></head><body><div id=\"cf-error-details\"><h1>Web server is down <span>Error code 521</span></h1></div></body></html>";
const keys = new Map();
const modes = new Map();
const requests = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const url = new URL(req.url, "http://127.0.0.1");
    const table = url.pathname.replace("/rest/v1/", "");
    const body = raw ? JSON.parse(raw) : null;
    const session = url.searchParams.get("session_name")?.slice(3) || (Array.isArray(body) ? body[0]?.session_name : body?.session_name);
    const mode = modes.get(session) || "ok";
    requests.push({ method: req.method, table, session, mode: table === "whatsapp_auth_keys" && req.method === "GET" ? mode : null });
    const json = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    if (table === "whatsapp_auth_keys" && req.method === "GET") {
      if (mode === "521") { res.writeHead(521, { "content-type": "text/html" }); return res.end(CLOUDFLARE_521); }
      const type = url.searchParams.get("key_type").slice(3);
      const ids = url.searchParams.get("key_id").replace(/^in\.\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
      return json(200, ids.filter((id) => keys.has(`${session}|${type}|${id}`)).map((id) => ({ key_id: id, key_data: keys.get(`${session}|${type}|${id}`) })));
    }
    if (table === "whatsapp_auth_keys" && req.method === "POST") {
      for (const row of body) keys.set(`${row.session_name}|${row.key_type}|${row.key_id}`, row.key_data);
      return json(201, []);
    }
    if (table === "whatsapp_auth_creds" && req.method === "GET") return json(200, []);
    return json(204, null);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_SERVICE_KEY = "chave-de-teste";
process.env.INTERNAL_API_KEY = "chave-interna-de-teste-000000";
process.env.DB_TIMEOUT_MS = "1000";

const { installBaileysRejectionGuard, CRASH_LOG_PATH } = await import(`${DIST}/utils/baileys-rejections.js`);
const { useSupabaseAuthState } = await import(`${DIST}/auth/supabase-auth-state.js`);
const guard = await import(`${DIST}/auth/key-read-guard.js`).catch(() => null);
const baileys = await import(`${APP}/node_modules/@whiskeysockets/baileys/lib/index.js`);
const { makeLibSignalRepository } = await import(`${APP}/node_modules/@whiskeysockets/baileys/lib/Signal/libsignal.js`);
const { makeMutex } = await import(`${APP}/node_modules/@whiskeysockets/baileys/lib/Utils/make-mutex.js`);
const { default: pino } = await import(`${APP}/node_modules/pino/pino.js`);
const silent = pino({ level: "silent" });
if (guard) Object.assign(guard.KEY_READ_POLICY, { budgetMs: 3_000, cooldownBaseMs: 2_000 });

installBaileysRejectionGuard();
let heartbeats = 0;
const transmissions = [];
const recoveries = [];
process.on("exit", (code) => {
  const crash = existsSync(CRASH_LOG_PATH) ? readFileSync(CRASH_LOG_PATH, "utf8") : "";
  log("process.exit", {
    code, versao: guard ? "nova" : "atual", heartbeats, transmissoes_B: transmissions.length,
    leituras_chave_A: requests.filter((r) => r.session === "numero-a" && r.mode).map((r) => r.mode),
    recuperacoes_pedidas: recoveries.length, apagou_ou_regravou_credenciais: requests.filter((r) => r.method === "DELETE" || (r.table === "whatsapp_auth_creds" && r.method !== "GET")).length,
    crash_log: crash ? crash.split("\n")[0] + " | " + (crash.match(/Error code 521|excedeu o limite|AUTH_KEYS_UNAVAILABLE/)?.[0] || "") : null
  });
});

const CONTACT = "5511999990000@s.whatsapp.net";
async function numberStore(name) {
  const auth = await useSupabaseAuthState(name, "conta-teste", { onKeysUnavailable: (error) => { recoveries.push(name); log("sessao_em_recuperacao", { numero: name, tentativas: error.attempts, espera_ms: error.cooldownMs }); } });
  const store = baileys.addTransactionCapability(auth.state.keys, silent, { maxCommitRetries: 10, delayBetweenTriesMs: 3000 });
  return { auth, store, repo: makeLibSignalRepository({ creds: auth.state.creds, keys: store }) };
}
async function seed(name) {
  const { auth, store, repo } = await numberStore(name);
  const identity = baileys.Curve.generateKeyPair();
  const signed = baileys.signedKeyPair(identity, 1);
  const preKey = baileys.Curve.generateKeyPair();
  await store.transaction(() => repo.injectE2ESession({ jid: CONTACT, session: {
    registrationId: 4321, identityKey: baileys.generateSignalPubKey(identity.public),
    signedPreKey: { keyId: 1, publicKey: baileys.generateSignalPubKey(signed.keyPair.public), signature: signed.signature },
    preKey: { keyId: 7, publicKey: baileys.generateSignalPubKey(preKey.public) }
  } }));
  return auth.state.creds;
}

const credsA = await seed("numero-a");
const credsB = await seed("numero-b");
// Armazenamentos novos (cache vazio): as leituras vão ao "banco".
const A = await numberStore("numero-a");
const B = await numberStore("numero-b");
B.repo = makeLibSignalRepository({ creds: credsB, keys: B.store });
A.repo = makeLibSignalRepository({ creds: credsA, keys: A.store });
const beat = setInterval(() => { heartbeats++; }, 100);

modes.set("numero-a", "521");
log("banco_521_para_numero_a");
// Igual ao Baileys em messages-recv (retryMutex.mutex sem await e sem catch).
makeMutex().mutex(async () => A.store.transaction(() => A.store.get("session", [`${CONTACT.split("@")[0]}.0`])));

const outageMs = Number(process.env.FALHA_MS || 2500);
const downUntil = Date.now() + outageMs;
for (let i = 1; Date.now() < downUntil; i++) {
  await new Promise((resolve) => setTimeout(resolve, 600));
  await B.store.transaction(async () => {
    const encrypted = await B.repo.encryptMessage({ jid: CONTACT, data: Buffer.from(`oferta ${i}`) });
    transmissions.push(i);
    log("envio_numero_b", { envio: i, cifrado: encrypted.type, bytes: encrypted.ciphertext.length });
  });
}

modes.set("numero-a", "ok");
log("banco_volta_para_numero_a");
// Espera a pausa do número A (se ele entrou em recuperação) antes de usá-lo de novo.
await new Promise((resolve) => setTimeout(resolve, 2_300));
const encryptedA = await A.repo.encryptMessage({ jid: CONTACT, data: Buffer.from("oferta A") });
log("envio_numero_a_apos_recuperacao", { cifrado: encryptedA.type });
clearInterval(beat);
server.close();
process.exit(0);
