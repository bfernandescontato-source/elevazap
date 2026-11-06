import { supabaseAdmin } from "@/lib/supabase";
import { DEFAULT_SEND_RULES, REPEAT_ACTIVE_STATUSES, repeatWindow, repeatedGroups, shiftOutOfQuietHours, type SendRules } from "../rules";

type Row = { quiet_hours_enabled: boolean; quiet_start: string; quiet_end: string; product_repeat_days: number };
type Database = { from: (table: string) => any };

/** available = a migration das regras já está no banco (tabela e coluna product_key). */
export type LoadedSendRules = SendRules & { available: boolean };

function isMissingTable(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /account_send_settings/.test(error.message || "")));
}

const hhmm = (value: string) => String(value || "").slice(0, 5);

export async function getSendRules(accountId: string, database: Database = supabaseAdmin()): Promise<LoadedSendRules> {
  const { data, error } = await database.from("account_send_settings")
    .select("quiet_hours_enabled,quiet_start,quiet_end,product_repeat_days").eq("account_id", accountId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { ...DEFAULT_SEND_RULES, available: false };
    throw error;
  }
  const row = data as Row | null;
  if (!row) return { ...DEFAULT_SEND_RULES, available: true };
  return {
    quietHoursEnabled: row.quiet_hours_enabled === true,
    quietStart: hhmm(row.quiet_start),
    quietEnd: hhmm(row.quiet_end),
    productRepeatDays: Number(row.product_repeat_days || 0),
    available: true
  };
}

/** Grava com o cliente da sessão (RLS da conta) e filtro explícito de conta. */
export async function saveSendRules(database: Database, accountId: string, userId: string | null, rules: SendRules) {
  const { error } = await database.from("account_send_settings").upsert({
    account_id: accountId,
    quiet_hours_enabled: rules.quietHoursEnabled,
    quiet_start: rules.quietStart,
    quiet_end: rules.quietEnd,
    product_repeat_days: rules.productRepeatDays,
    updated_by: userId,
    updated_at: new Date().toISOString()
  }, { onConflict: "account_id" });
  if (error) throw error;
  return getSendRules(accountId, database);
}

/** Horário que o envio vai realmente sair (o banco aplica a mesma regra na fila). */
export function effectiveSendAt(at: string, rules: SendRules) {
  return shiftOutOfQuietHours(new Date(at), rules).toISOString();
}

/** Grupos em que o produto é repetido no prazo da conta (só com a regra ligada). */
export async function findRepeatedGroups(accountId: string, key: string | null, groupJids: string[], at: string, rules: LoadedSendRules) {
  const days = rules.productRepeatDays;
  if (!rules.available || !key || days <= 0 || !groupJids.length) return new Set<string>();
  const when = new Date(at);
  const { from, to } = repeatWindow(when, days);
  const { data, error } = await supabaseAdmin().from("envios_grupo")
    .select("group_jid,product_key,status,scheduled_at")
    .eq("account_id", accountId).eq("product_key", key).in("group_jid", groupJids)
    .in("status", [...REPEAT_ACTIVE_STATUSES]).gt("scheduled_at", from).lt("scheduled_at", to)
    .limit(1000);
  if (error) throw error;
  return repeatedGroups(data || [], key, groupJids, when, days);
}
