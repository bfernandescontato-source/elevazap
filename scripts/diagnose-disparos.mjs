#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const hoursArg = process.argv.find((arg) => arg.startsWith("--hours="));
const hours = Number(hoursArg?.slice(8) ?? 24);
if (!Number.isFinite(hours) || hours <= 0) throw new Error("Use --hours com um número maior que zero.");
const emailsArg = process.argv.find((arg) => arg.startsWith("--emails="));
const requestedEmails = (emailsArg?.slice(9) ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

const root = process.cwd();
const config = {
  ...loadEnv(path.join(root, ".env.local")),
  ...loadEnv(path.join(root, ".env.production.local")),
  ...loadEnv(path.join(root, "web/.env.local"))
};
const url = config.SUPABASE_URL;
const key = config.SUPABASE_SERVICE_KEY;
if (!url || !key || url.includes("[SENSITIVE]") || key.includes("[SENSITIVE]")) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_KEY precisam conter os valores reais em .env.production.local (não cole a chave no código nem a envie por chat).");
}

const db = createClient(url, key, { auth: { persistSession: false } });
const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

function summarize(rows) {
  const out = {};
  for (const row of rows) {
    const account = row.account_id ?? "sem_conta";
    const status = row.status ?? "sem_status";
    const error = row.last_error_code || row.erro || "";
    const key = error ? `${status} — ${error}` : status;
    out[account] ??= {};
    out[account][key] = (out[account][key] ?? 0) + 1;
  }
  return out;
}

async function get(table, columns) {
  const { data, error } = await db.from(table).select(columns).gte("created_at", since).order("created_at", { ascending: false }).limit(5000);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

const usersPromise = requestedEmails.length
  ? db.from("app_users").select("id,email,name,status,account_id").in("email", requestedEmails)
  : Promise.resolve({ data: [], error: null });
const [accountsResult, sendersResult, usersResult, direct, group] = await Promise.all([
  db.from("accounts").select("id,name,status,plan,updated_at").order("name"),
  db.from("whatsapp_senders").select("account_id,session_name,label,updated_at").order("updated_at", { ascending: false }),
  usersPromise,
  get("envios", "account_id,status,erro,last_error_code,attempts,scheduled_at,created_at,updated_at,sent_at,whatsapp_session_name,processing_deadline_at,reconciliation_required"),
  get("envios_grupo", "account_id,lote_id,status,erro,last_error_code,attempts,scheduled_at,created_at,updated_at,sent_at,whatsapp_session_name,processing_deadline_at,reconciliation_required")
]);
if (accountsResult.error) throw new Error(`accounts: ${accountsResult.error.message}`);
if (sendersResult.error) throw new Error(`whatsapp_senders: ${sendersResult.error.message}`);
if (usersResult.error) throw new Error(`app_users: ${usersResult.error.message}`);

const accountIds = new Set(usersResult.data.map((user) => user.account_id));
const selectAccounts = (rows) => requestedEmails.length ? rows.filter((row) => accountIds.has(row.account_id)) : rows;
const selectedDirect = selectAccounts(direct);
const selectedGroup = selectAccounts(group);
const active = [...selectedDirect, ...selectedGroup].filter((row) => ["pendente", "enfileirado", "processando", "incerto"].includes(row.status));
console.log(JSON.stringify({
  consulted_at: new Date().toISOString(),
  since,
  requested_users: usersResult.data,
  accounts: requestedEmails.length ? accountsResult.data.filter((account) => accountIds.has(account.id)) : accountsResult.data,
  senders: requestedEmails.length ? sendersResult.data.filter((sender) => accountIds.has(sender.account_id)) : sendersResult.data,
  direct_messages: { total: selectedDirect.length, by_account_and_result: summarize(selectedDirect) },
  group_messages: { total: selectedGroup.length, by_account_and_result: summarize(selectedGroup) },
  active_or_uncertain: active
}, null, 2));
