import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";
import { randomUUID } from "crypto";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const supabase = supabaseAdmin();
  const { data: agent } = await supabase.from("support_agent").select("id, whatsapp_session_id").limit(1).maybeSingle();
  if (!agent) return NextResponse.json({ status: "disconnected", qr: "" });

  try {
    return NextResponse.json(await callWhatsappService(`/support/${agent.id}/status`));
  } catch {
    return NextResponse.json({ status: "disconnected", qr: "" });
  }
}

// POST: start a new session (connect new number via QR)
export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request);
  if (guard) return guard;

  const supabase = supabaseAdmin();
  const { data: agent } = await supabase
    .from("support_agent")
    .select("id, whatsapp_session_id")
    .limit(1)
    .maybeSingle();

  if (!agent) return NextResponse.json({ error: "Agente não encontrado. Acesse a configuração primeiro." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  // Allow reusing an existing session_id or generating a new one
  const sessionId = body.sessionId || `support_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  try {
    await callWhatsappService(`/support/${agent.id}/connect`, {
      method: "POST",
      body: JSON.stringify({ sessionId })
    });
    return NextResponse.json({ ok: true, sessionId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE: disconnect support session
export async function DELETE(request: NextRequest) {
  const guard = await guardAdminMutation(request);
  if (guard) return guard;

  const supabase = supabaseAdmin();
  const { data: agent } = await supabase.from("support_agent").select("id").limit(1).maybeSingle();
  if (!agent) return NextResponse.json({ ok: true });

  await callWhatsappService(`/support/${agent.id}/disconnect`, { method: "POST" }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
