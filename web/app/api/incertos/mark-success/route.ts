import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const { id, kind, resolution_note } = await request.json();
  const table = kind === "grupo" ? "envios_grupo" : "envios";
  const sb = supabaseAdmin();
  const { data } = await sb.from(table).update({ status: "sucesso", resolution_note, resolved_at: new Date().toISOString(), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "incerto").select("lote_id").maybeSingle();
  if (kind === "grupo" && data?.lote_id) await sb.rpc("recalc_lote_counts", { p_lote_id: data.lote_id });
  return NextResponse.json({ ok: true });
}
