import { supabaseAdmin } from "@/lib/supabase";
import { addDays, brasiliaInstant } from "../schedule-plan";
import { CatalogDispatchError } from "./catalog-dispatch-service";

export type AgendaStatus = "programado" | "enviando" | "enviado" | "parcial" | "erro" | "incerto" | "cancelado" | "pausado";

export type AgendaItem = {
  id: string; loteId: string; provider: string; externalItemId: string; productName: string; imageUrl: string | null;
  price: number | null; originalPrice: number | null; affiliateUrl: string | null; message: string; groupCount: number;
  scheduledAt: string; status: AgendaStatus; sent: number; failed: number; pending: number;
};

/** Liberação gradual: só contas marcadas veem a Agenda e o agendamento em massa. */
export async function isCatalogAgendaEnabled(accountId: string) {
  const { data } = await supabaseAdmin().from("accounts").select("catalog_agenda_enabled").eq("id", accountId).maybeSingle();
  return data?.catalog_agenda_enabled === true;
}

function agendaStatus(lote: any, scheduledAt: string): AgendaStatus {
  const status = String(lote?.status || "pendente");
  const sent = Number(lote?.enviados || 0); const failed = Number(lote?.erros || 0);
  if (status === "cancelado" || status === "pausado" || status === "incerto") return status;
  if (status === "sucesso") return failed > 0 ? "parcial" : "enviado";
  if (status === "erro") return sent > 0 ? "parcial" : "erro";
  if (status === "processando") return "enviando";
  return new Date(scheduledAt).getTime() > Date.now() ? "programado" : "enviando";
}

function dayRange(day: string) {
  return { from: brasiliaInstant(day, "00:00").toISOString(), to: brasiliaInstant(addDays(day, 1), "00:00").toISOString() };
}

/** Ofertas do Catálogo marcadas para o dia (fuso de Brasília), menos as removidas. */
export async function listCatalogAgenda(accountId: string, day: string): Promise<AgendaItem[]> {
  const { from, to } = dayRange(day);
  const { data, error } = await supabaseAdmin().from("catalog_scheduled_offers")
    .select("id,lote_id,provider,external_item_id,product_name,image_url,price,original_price,affiliate_url,message,group_count,scheduled_at,envios_grupo_lotes(status,enviados,erros,pendentes)")
    .eq("account_id", accountId).gte("scheduled_at", from).lt("scheduled_at", to)
    .order("scheduled_at", { ascending: true }).limit(500);
  if (error) throw new CatalogDispatchError("Não foi possível carregar a agenda.", 500);
  return (data || []).map((row: any) => {
    const lote = Array.isArray(row.envios_grupo_lotes) ? row.envios_grupo_lotes[0] : row.envios_grupo_lotes;
    return {
      id: row.id, loteId: row.lote_id, provider: row.provider, externalItemId: row.external_item_id, productName: row.product_name,
      imageUrl: row.image_url, price: row.price === null ? null : Number(row.price), originalPrice: row.original_price === null ? null : Number(row.original_price),
      affiliateUrl: row.affiliate_url, message: row.message, groupCount: row.group_count, scheduledAt: row.scheduled_at,
      status: agendaStatus(lote, row.scheduled_at), sent: Number(lote?.enviados || 0), failed: Number(lote?.erros || 0), pending: Number(lote?.pendentes || 0)
    } satisfies AgendaItem;
  }).filter(item => item.status !== "cancelado");
}

/** Produtos que já estão na Agenda do dia (para avisar antes de agendar de novo). */
export async function scheduledItemKeys(accountId: string, day: string, items: Array<{ provider: string; externalItemId: string }>) {
  if (!items.length) return new Set<string>();
  const { from, to } = dayRange(day);
  const { data } = await supabaseAdmin().from("catalog_scheduled_offers")
    .select("provider,external_item_id,envios_grupo_lotes(status)")
    .eq("account_id", accountId).gte("scheduled_at", from).lt("scheduled_at", to)
    .in("external_item_id", Array.from(new Set(items.map(item => item.externalItemId))));
  return new Set((data || []).filter((row: any) => {
    const lote = Array.isArray(row.envios_grupo_lotes) ? row.envios_grupo_lotes[0] : row.envios_grupo_lotes;
    return lote?.status !== "cancelado";
  }).map((row: any) => `${row.provider}:${row.external_item_id}`));
}

/** Muda o horário dos envios que ainda não saíram (função atômica no banco). */
export async function rescheduleCatalogOffer(accountId: string, id: string, scheduledAt: string) {
  if (new Date(scheduledAt).getTime() < Date.now() - 60_000) throw new CatalogDispatchError("Escolha um horário a partir de agora.", 400);
  const { data, error } = await supabaseAdmin().rpc("reschedule_catalog_offer", { p_account_id: accountId, p_offer_id: id, p_scheduled_at: scheduledAt });
  if (error) throw new CatalogDispatchError(error.code === "P0002" || error.code === "22023" ? error.message : "Não foi possível mudar o horário.", error.code === "P0002" ? 404 : error.code === "22023" ? 409 : 500);
  return Number(data || 0);
}

/** Tira da fila os envios que ainda não saíram. */
export async function cancelCatalogOffer(accountId: string, id: string) {
  const sb = supabaseAdmin();
  // transition_lote_atomic não confere a conta; a posse do lote é verificada aqui antes.
  const { data: item } = await sb.from("catalog_scheduled_offers").select("lote_id").eq("id", id).eq("account_id", accountId).maybeSingle();
  if (!item) throw new CatalogDispatchError("Oferta não encontrada.", 404);
  const { error } = await sb.rpc("transition_lote_atomic", { p_lote_id: item.lote_id, p_action: "cancel" });
  if (error) throw new CatalogDispatchError(error.code === "22023" ? "Esta oferta já foi enviada e não pode ser removida." : "Não foi possível remover da fila.", error.code === "22023" ? 409 : 500);
}
