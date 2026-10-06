import { supabaseAdmin } from "@/lib/supabase";

export type ShopeeCoupon = {
  promotionId: string; code: string; boldText: string; lightText: string; iconText: string;
  labels: string[]; redirectUrl: string; collectionId: string | null; endTime: number | null; percentageUsed: number | null;
};

const int = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));

// A resposta da Shopee vem em formatos variados. Coletamos recursivamente:
//  - nós "voucher" (têm voucher_identifier.voucher_code)
//  - nós de texto (collection_voucher_entity_info, com voucher_id + bold/light)
// e juntamos por id. Assim funciona mesmo que venham separados.
function coletar(node: any, vouchers: any[], infos: any[]) {
  if (!node || typeof node !== "object") return;
  if (node.voucher_identifier?.voucher_code) vouchers.push(node);
  if (node.bold_text && (node.voucher_id != null || node.collection_id != null)) infos.push(node);
  for (const v of Array.isArray(node) ? node : Object.values(node)) if (v && typeof v === "object") coletar(v, vouchers, infos);
}

function textoDaRecompensa(reward: any): string {
  const p = int(reward?.percentage);
  if (p) return `${p}% OFF`;
  const v = int(reward?.value);
  if (v) return `R$ ${(v / 100000).toFixed(2).replace(".", ",")} OFF`;
  return "Cupom Shopee";
}

export async function importShopeeCoupons(responses: any[]) {
  const agora = new Date().toISOString();
  const vouchers: any[] = []; const infos: any[] = [];
  for (const r of responses) coletar(r, vouchers, infos);
  const infoPorId = new Map<string, any>();
  for (const info of infos) infoPorId.set(String(info.voucher_id ?? info.promotion_id ?? ""), info);

  const porId = new Map<string, any>();
  for (const v of vouchers) {
    const id = v.voucher_identifier; const reward = v.reward_info || {}; const time = v.time_info || {}; const quota = v.quota_info || {}; const ui = v.ui_info || {};
    if (time.has_expired || quota.fully_redeemed || quota.fully_used || quota.disabled) continue;
    const pid = String(id.promotion_id ?? id.voucher_code);
    if (porId.has(pid)) continue;
    const info = infoPorId.get(pid) || infoPorId.get(String(id.promotion_id)) || {};
    porId.set(pid, {
      promotion_id: pid, voucher_code: String(id.voucher_code), signature: id.signature ?? null, signature_source: int(id.signature_source),
      bold_text: info.bold_text ?? textoDaRecompensa(reward), light_text: info.light_text ?? null, icon_text: ui.icon_text ?? null,
      labels: Array.isArray(ui.customised_labels) ? ui.customised_labels : [], redirect_url: info.redirect_url ?? "https://shopee.com.br/m/cupom-de-desconto",
      collection_id: info.collection_id != null ? String(info.collection_id) : null, end_time: int(time.end_time),
      reward_type: int(reward.reward_type), percentage: int(reward.percentage), min_spend: int(reward.min_spend), value: int(reward.value), cap: int(reward.cap),
      percentage_used: int(quota.percentage_used), last_seen_at: agora, active: true
    });
  }
  const rows = [...porId.values()];
  // Diagnóstico: se chegaram respostas mas nada foi extraído, registra a cara do que veio.
  if (!rows.length && responses.length) {
    const amostra = responses.slice(0, 2).map(r => { try { return Object.keys(r || {}).join(","); } catch { return typeof r; } });
    console.error({ event: "shopee_coupons_vazio", respostas: responses.length, vouchers_vistos: vouchers.length, infos_vistos: infos.length, topo: amostra });
  }
  const db = supabaseAdmin();
  if (rows.length) {
    const { error } = await db.from("shopee_coupons").upsert(rows, { onConflict: "promotion_id" });
    if (error) throw error;
    await db.from("shopee_coupons").update({ active: false }).lt("last_seen_at", agora);
  }
  return { recebidos: responses.length, cupons: rows.length, vouchers_vistos: vouchers.length };
}

export async function listShopeeCoupons(): Promise<ShopeeCoupon[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const { data, error } = await supabaseAdmin().from("shopee_coupons").select("*").eq("active", true).order("last_seen_at", { ascending: false }).limit(300);
  if (error) throw error;
  return (data || [])
    .filter((r: any) => (!r.end_time || r.end_time > nowSec) && (r.percentage_used == null || r.percentage_used < 100))
    .map((r: any) => ({ promotionId: r.promotion_id, code: r.voucher_code, boldText: r.bold_text || "", lightText: r.light_text || "", iconText: r.icon_text || "", labels: r.labels || [], redirectUrl: r.redirect_url || "", collectionId: r.collection_id, endTime: r.end_time, percentageUsed: r.percentage_used }));
}
