import type { SupabaseClient } from "@supabase/supabase-js";

type Database = SupabaseClient;

async function list(database: Database, table: "envios" | "envios_grupo", accountId: string, limit: number) {
  const { data, error } = await database.from(table).select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export const listIndividualDispatches = (database: Database, accountId: string) => list(database, "envios", accountId, 300);
export const listGroupDispatches = (database: Database, accountId: string) => list(database, "envios_grupo", accountId, 300);

export async function listDispatchBatches(database: Database, accountId: string, createdAfter?: string | null) {
  let query = database
    .from("envios_grupo_lotes")
    .select("*,modelos_mensagem(id,nome)")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (createdAfter) query = query.gt("created_at", createdAfter);
  const { data, error } = await query.limit(200);
  // If the join fails (e.g. migration not yet applied), fall back to plain select
  if (error) {
    let fallbackQuery = database
      .from("envios_grupo_lotes")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });
    if (createdAfter) fallbackQuery = fallbackQuery.gt("created_at", createdAfter);
    const fallback = await fallbackQuery.limit(200);
    if (fallback.error) throw fallback.error;
    return fallback.data || [];
  }
  return data || [];
}

export async function listUncertainDispatches(database: Database, accountId: string) {
  const [individual, groups] = await Promise.all([
    database.from("envios").select("*").eq("account_id", accountId).eq("status", "incerto").order("created_at", { ascending: false }),
    database.from("envios_grupo").select("*").eq("account_id", accountId).eq("status", "incerto").order("created_at", { ascending: false })
  ]);
  if (individual.error) throw individual.error;
  if (groups.error) throw groups.error;
  return { envios: individual.data || [], grupos: groups.data || [] };
}
