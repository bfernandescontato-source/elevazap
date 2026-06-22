import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const { lote_id } = await request.json();
  const sb = supabaseAdmin();
  await sb.from("envios_grupo").update({ status: "pendente", claim_token: null, updated_at: new Date().toISOString() }).eq("lote_id", lote_id).eq("status", "pausado");
  await sb.rpc("recalc_lote_counts", { p_lote_id: lote_id });
  return NextResponse.json({ ok: true });
}
