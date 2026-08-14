import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extensionCorsHeaders, requireMercadoLivreExtension } from "@/modules/offer-autopilot/server/mercado-livre-extension";

const LINK_PATTERN = /^https:\/\/meli\.la\/[A-Za-z0-9_-]+$/i;
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const integration = await requireMercadoLivreExtension(request);
  if (!integration) return NextResponse.json({ error: "Extensão não autorizada." }, { status: 401, headers: extensionCorsHeaders });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !["completed", "failed"].includes(body.status)) return NextResponse.json({ error: "Resultado inválido." }, { status: 400, headers: extensionCorsHeaders });
  if (body.status === "completed" && (typeof body.affiliate_link !== "string" || !LINK_PATTERN.test(body.affiliate_link))) {
    return NextResponse.json({ error: "Link retornado inválido." }, { status: 400, headers: extensionCorsHeaders });
  }
  const admin = supabaseAdmin();
  const { data: job } = await admin.from("affiliate_generation_jobs").select("id,kind,offer_link_id")
    .eq("id", id).eq("account_id", integration.account_id).eq("provider", "mercado_livre").eq("status", "claimed").maybeSingle();
  if (!job) return NextResponse.json({ error: "Trabalho não encontrado ou já finalizado." }, { status: 404, headers: extensionCorsHeaders });
  const now = new Date().toISOString();
  await admin.from("affiliate_generation_jobs").update({
    status: body.status, affiliate_link: body.status === "completed" ? body.affiliate_link : null,
    error_code: body.status === "failed" ? "MERCADO_LIVRE_GENERATION_FAILED" : null,
    error_message: body.status === "failed" ? String(body.error_message || "Falha no Gerador.").slice(0, 500) : null,
    completed_at: now, updated_at: now
  }).eq("id", job.id).eq("account_id", integration.account_id);
  if (job.kind === "connection_test") {
    await admin.from("affiliate_integrations").update({
      status: body.status === "completed" ? "connected" : "error",
      affiliate_tag: body.status === "completed" && typeof body.affiliate_tag === "string" ? body.affiliate_tag.slice(0, 120) : integration.affiliate_tag,
      last_tested_at: now, last_error: body.status === "failed" ? String(body.error_message || "Teste real falhou.").slice(0, 500) : null,
      updated_at: now
    }).eq("id", integration.id).eq("account_id", integration.account_id);
  }
  return NextResponse.json({ ok: true }, { headers: extensionCorsHeaders });
}
