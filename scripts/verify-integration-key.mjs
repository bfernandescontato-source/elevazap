#!/usr/bin/env node
// Confere se INTEGRATION_ENCRYPTION_KEY descriptografa os segredos reais do banco.
// Somente leitura (GET). Nunca imprime segredos, nem a chave: só contagens e o
// fingerprint da chave, que serve pra comparar Railway, Vercel e VPS.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... INTEGRATION_ENCRYPTION_KEY=... \
//     node scripts/verify-integration-key.mjs
//   node scripts/verify-integration-key.mjs --self-test
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const TARGETS = [
  { table: "affiliate_integrations", column: "encrypted_app_secret", label: "Shopee (app secret)" },
  { table: "affiliate_integrations", column: "encrypted_auth_data", label: "Afiliados (auth data)" },
  { table: "mercado_livre_platform_integration", column: "encrypted_access_token", label: "Mercado Livre plataforma (access token)" },
  { table: "mercado_livre_platform_integration", column: "encrypted_refresh_token", label: "Mercado Livre plataforma (refresh token)" },
  { table: "official_connections", column: "encrypted_access_token", label: "Meta oficial (access token)" },
  { table: "official_connections", column: "encrypted_app_secret", label: "Meta oficial (app secret)" }
];
const PAGE_SIZE = 1000;

function loadKey(encoded) {
  if (!encoded) throw new Error("INTEGRATION_ENCRYPTION_KEY não definida.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error(`Chave inválida: esperado base64 de 32 bytes, veio de ${key.length}.`);
  return key;
}

function fingerprint(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

// Mesmo formato de web/lib/integration-crypto.ts: v1.<iv>.<tag>.<cifrado>, AES-256-GCM.
function encrypt(secret, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decrypt(value, key) {
  const [version, iv, tag, encrypted] = String(value).split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("formato");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function classify(error) {
  if (error instanceof Error && error.message === "formato") return "formato inválido";
  return "chave errada (falha de autenticação)";
}

function selfTest() {
  const key = randomBytes(32);
  const sample = encrypt("segredo-de-teste", key);
  if (decrypt(sample, key) !== "segredo-de-teste") throw new Error("Round-trip falhou.");
  let rejected = false;
  try { decrypt(sample, randomBytes(32)); } catch { rejected = true; }
  if (!rejected) throw new Error("Uma chave diferente não deveria descriptografar.");
  console.log("self-test ok: round-trip e rejeição de chave errada.");
}

async function fetchColumn({ table, column }, baseUrl, serviceKey) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = `${baseUrl}/rest/v1/${table}?select=id,${column}&${column}=not.is.null&order=id&limit=${PAGE_SIZE}&offset=${offset}`;
    let response;
    try { response = await fetch(url, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }); }
    catch { throw new Error(`não consegui conectar em ${baseUrl}. Confira a URL do Supabase.`); }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`o Supabase recusou a SUPABASE_SERVICE_KEY (HTTP ${response.status}). Confira se copiou a chave inteira, a service_role/secret.`);
    }
    if (!response.ok) throw new Error(`${table}.${column}: HTTP ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// Lê uma linha do terminal. Com `secret`, nada é ecoado (só o tamanho, pra
// conferir que a colagem funcionou). Aceita "NOME=valor" e aspas na colagem.
function ask(question, secret) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    let value = "";
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      const clean = value.trim().replace(/^[A-Z_]+=/, "").replace(/^["']|["']$/g, "");
      stdout.write(secret ? `\n  recebido (${clean.length} caracteres)\n` : "\n");
      resolve(clean);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "") { stdin.setRawMode(false); stdout.write("\n"); process.exit(130); }
        if (char === "" || char === "\b") { value = value.slice(0, -1); if (!secret) stdout.write("\b \b"); continue; }
        if (char >= " ") { value += char; if (!secret) stdout.write(char); }
      }
    };
    stdin.on("data", onData);
  });
}

async function promptMissingEnv() {
  const wanted = [
    ["SUPABASE_URL", "Cole a URL do Supabase e aperte Enter: ", false],
    ["SUPABASE_SERVICE_KEY", "Cole a SUPABASE_SERVICE_KEY e aperte Enter (não aparece na tela): ", true],
    ["INTEGRATION_ENCRYPTION_KEY", "Cole a INTEGRATION_ENCRYPTION_KEY e aperte Enter (não aparece na tela): ", true]
  ].filter(([name]) => !process.env[name]);
  if (!process.stdin.isTTY) return;
  for (const [index, [name, question, secret]] of wanted.entries()) {
    process.env[name] = await ask(`${index + 1}/${wanted.length} ${question}`, secret);
  }
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  await promptMissingEnv();

  const baseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!baseUrl || !serviceKey) {
    console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_KEY.");
    process.exit(2);
  }
  let key;
  try { key = loadKey(process.env.INTEGRATION_ENCRYPTION_KEY); }
  catch (error) { console.error(error.message); process.exit(2); }

  console.log(`fingerprint da chave: ${fingerprint(key)}  (compare entre Railway, Vercel e VPS)\n`);
  let failed = 0;
  for (const target of TARGETS) {
    const rows = await fetchColumn(target, baseUrl, serviceKey);
    const failures = [];
    for (const row of rows) {
      try { decrypt(row[target.column], key); }
      catch (error) { failures.push({ id: row.id, reason: classify(error) }); }
    }
    failed += failures.length;
    const status = failures.length ? "FALHOU" : "ok";
    console.log(`${status.padEnd(6)} ${target.label}: ${rows.length - failures.length}/${rows.length}`);
    for (const failure of failures.slice(0, 5)) console.log(`       id ${failure.id}: ${failure.reason}`);
    if (failures.length > 5) console.log(`       ... e mais ${failures.length - 5}`);
  }
  console.log(failed ? `\n${failed} segredo(s) NÃO descriptografam. Não faça a virada com essa chave.` : "\nTodos os segredos descriptografam. A chave é a correta.");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`Erro: ${error.message}`);
  process.exit(2);
});
