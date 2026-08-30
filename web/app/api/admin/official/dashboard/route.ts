import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { supabaseAdmin } from "@/lib/supabase";
import { legacyConnectionSummary } from "@/modules/official-whatsapp/server/official-connections";

export async function GET() {
  const guard = await requireInternalAdmin(); if (guard.error) return guard.error;
  try {
    const db = supabaseAdmin();
    const [automations, flows, connections, processing, recent] = await Promise.all([
      db.from("official_automations").select("id", { count: "exact", head: true }).eq("active", true),
      db.from("official_flows").select("id", { count: "exact", head: true }).eq("active", true),
      db.from("official_connections").select("id", { count: "exact", head: true }).neq("status", "disabled"),
      db.from("official_broadcasts").select("id", { count: "exact", head: true }).eq("status", "processing"),
      db.from("official_broadcasts").select("id,name,status,total_rows,created_at").order("created_at", { ascending: false }).limit(5)
    ]);
    for (const result of [automations, flows, connections, processing, recent]) if (result.error) throw result.error;
    return NextResponse.json({ automations: automations.count || 0, flows: flows.count || 0, accounts: (connections.count || 0) + (legacyConnectionSummary() ? 1 : 0), processing: processing.count || 0, recent: recent.data || [] });
  } catch { return NextResponse.json({ error: "Não foi possível carregar o painel. Tente novamente." }, { status: 503 }); }
}
