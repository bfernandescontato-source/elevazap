import { supabase } from "./supabase.js";

export type QueueTable = "envios" | "envios_grupo";
export type DatabaseCapabilities = Record<QueueTable, { stabilityColumns: boolean }>;

const optionalStabilityFields = new Set(["processing_deadline_at", "reconciliation_required", "last_error_code"]);

async function tableHasStabilityColumns(table: QueueTable) {
  const { error } = await supabase.from(table).select("processing_deadline_at,reconciliation_required,last_error_code").limit(1);
  if (!error) return true;
  if (error.code === "42703" || error.code === "PGRST204" || /column .* does not exist|could not find/i.test(error.message)) return false;
  throw new Error(`schema.detect:${table}: ${error.message}`);
}

export async function detectDatabaseCapabilities(): Promise<DatabaseCapabilities> {
  const [envios, enviosGrupo] = await Promise.all([
    tableHasStabilityColumns("envios"),
    tableHasStabilityColumns("envios_grupo")
  ]);
  return {
    envios: { stabilityColumns: envios },
    envios_grupo: { stabilityColumns: enviosGrupo }
  };
}

export function compatibleQueueUpdate(capabilities: DatabaseCapabilities, table: QueueTable, values: Record<string, unknown>) {
  if (capabilities[table].stabilityColumns) return values;
  return Object.fromEntries(Object.entries(values).filter(([key]) => !optionalStabilityFields.has(key)));
}
