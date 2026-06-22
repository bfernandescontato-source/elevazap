import { supabase } from "./supabase.js";

const uncertainError = "Serviço reiniciou durante envio. Status incerto para evitar duplicidade automática.";

export async function recoverStuckJobsOnBoot() {
  for (const table of ["envios", "envios_grupo"]) {
    await supabase.from(table).update({ status: "pendente", claim_token: null, updated_at: new Date().toISOString() }).eq("status", "enfileirado");
    await supabase.from(table).update({ status: "incerto", erro: uncertainError, updated_at: new Date().toISOString() }).eq("status", "processando");
  }
}

export async function periodicReclaim() {
  const oldQueued = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const oldProcessing = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  for (const table of ["envios", "envios_grupo"]) {
    await supabase.from(table).update({ status: "pendente", claim_token: null, updated_at: new Date().toISOString() }).eq("status", "enfileirado").lt("claimed_at", oldQueued);
    await supabase.from(table).update({ status: "incerto", erro: "Processamento antigo marcado como incerto para evitar duplicidade automática.", updated_at: new Date().toISOString() }).eq("status", "processando").lt("started_at", oldProcessing);
  }
}
