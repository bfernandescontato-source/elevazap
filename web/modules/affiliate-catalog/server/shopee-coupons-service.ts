import { supabaseAdmin } from "@/lib/supabase";

export type ShopeeCoupon = {
  promotionId: string; code: string; boldText: string; lightText: string; iconText: string;
  labels: string[]; redirectUrl: string; collectionId: string | null; endTime: number | null; percentageUsed: number | null;
};

// A resposta da Shopee aninha os cupons de formas variadas. Procuramos recursivamente
// qualquer entrada que tenha "voucher" + "collection_voucher_entity_info" (o formato do card).
function extrairEntradas(node: any, saida: any[] = []): any[] {
  if (!node || typeof node !== "object") return saida;
  if (node.voucher?.voucher_identifier?.voucher_code && node.collection_voucher_entity_info) saida.push(node);
  for (const v of Array.isArray(node) ? node : Object.values(node)) if (v && typeof v === "object") extrairEntradas(v, saida);
  return saida;
}

const int = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));

export async function importShopeeCoupons(responses: any[]) {
  const agora = new Date().toISOString();
  const entradas = responses.flatMap(r => extrairEntradas(r));
  const porId = new Map<string, any>();
  for (const e of entradas) {
    const v = e.voucher; const id = v.voucher_identifier; const reward = v.reward_info || {}; const time = v.time_info || {}; const quota = v.quota_info || {}; const ui = v.ui_info || {}; const info = e.collection_voucher_entity_info || {};
    // Só cupons válidos: não expirados, não esgotados, não totalmente usados.
    if (time.has_expired || quota.fully_redeemed || quota.fully_used || quota.disabled) continue;
    const pid = String(id.promotion_id ?? info.voucher_id ?? id.voucher_code);
    if (porId.has(pid)) continue;
    porId.set(pid, {
      promotion_id: pid, voucher_code: String(id.voucher_code), signature: id.signature ?? null, signature_source: int(id.signature_source),
      bold_text: info.bold_text ?? null, light_text: info.light_text ?? null, icon_text: ui.icon_text ?? null,
      labels: Array.isArray(ui.customised_labels) ? ui.customised_labels : [], redirect_url: info.redirect_url ?? null,
      collection_id: info.collection_id != null ? String(info.collection_id) : null, end_time: int(time.end_time),
      reward_type: int(reward.reward_type), percentage: int(reward.percentage), min_spend: int(reward.min_spend), value: int(reward.value), cap: int(reward.cap),
      percentage_used: int(quota.percentage_used), last_seen_at: agora, active: true
    });
  }
  const rows = [...porId.values()];
  const db = supabaseAdmin();
  if (rows.length) {
    const { error } = await db.from("shopee_coupons").upsert(rows, { onConflict: "promotion_id" });
    if (error) throw error;
    await db.from("shopee_coupons").update({ active: false }).lt("last_seen_at", agora);
  }
  return { recebidos: responses.length, cupons: rows.length };
}

export async function listShopeeCoupons(): Promise<ShopeeCoupon[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const { data, error } = await supabaseAdmin().from("shopee_coupons").select("*").eq("active", true).order("last_seen_at", { ascending: false }).limit(300);
  if (error) throw error;
  return (data || [])
    .filter((r: any) => !r.end_time || r.end_time > nowSec)
    .map((r: any) => ({ promotionId: r.promotion_id, code: r.voucher_code, boldText: r.bold_text || "", lightText: r.light_text || "", iconText: r.icon_text || "", labels: r.labels || [], redirectUrl: r.redirect_url || "", collectionId: r.collection_id, endTime: r.end_time, percentageUsed: r.percentage_used }));
}
