import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extensionCorsHeaders, requireMercadoLivreExtension } from "@/modules/offer-autopilot/server/mercado-livre-extension";

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }

export async function GET(request: NextRequest) {
  const integration = await requireMercadoLivreExtension(request);
  if (!integration) return NextResponse.json({ error: "Extensão não autorizada." }, { status: 401, headers: extensionCorsHeaders });
  const admin = supabaseAdmin();
  const now = new Date().toISOString();
  await admin.from("affiliate_generation_jobs").update({ status: "expired", error_code: "JOB_EXPIRED", error_message: "Tempo de processamento excedido." })
    .eq("account_id", integration.account_id).eq("provider", "mercado_livre").eq("status", "pending").lte("expires_at", now);
  const { data: candidate } = await admin.from("affiliate_generation_jobs")
    .select("id,input_url,affiliate_tag,kind").eq("account_id", integration.account_id)
    .eq("provider", "mercado_livre").eq("status", "pending").gt("expires_at", now)
    .order("created_at").limit(1).maybeSingle();
  if (!candidate) return NextResponse.json({ job: null }, { headers: extensionCorsHeaders });
  const { data: claimed } = await admin.from("affiliate_generation_jobs").update({ status: "claimed", claimed_at: now, updated_at: now })
    .eq("id", candidate.id).eq("account_id", integration.account_id).eq("status", "pending")
    .select("id,input_url,affiliate_tag,kind").maybeSingle();
  return NextResponse.json({ job: claimed || null }, { headers: extensionCorsHeaders });
}
