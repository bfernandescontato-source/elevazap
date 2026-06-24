import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminMutation(request);
  if (guard) return guard;

  const { text } = await request.json();
  if (!text?.trim()) return NextResponse.json({ error: "Texto obrigatório." }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data: conv } = await supabase
    .from("support_conversation")
    .select("*, support_agent(whatsapp_session_id)")
    .eq("id", params.id)
    .maybeSingle();

  if (!conv) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  // Send via whatsapp-service: reuse existing /mensagem endpoint pattern
  // We call the service to send via the support session; the service will detect it as a human-sent
  // message via the fromMe listener. We record it here preemptively.
  try {
    // The whatsapp-service support session will detect fromMe + not-AI-sent → mark takeover
    // but since we record it here with sender='human', we pre-empt the takeover.
    // We send directly through the existing send endpoint but targeting the support session.
    // Simpler: call a dedicated send route on the service.
    const sessionId = (conv as any).support_agent?.whatsapp_session_id;
    if (!sessionId) throw new Error("Sessão de suporte não configurada.");

    const result = await callWhatsappService(`/support/${conv.agent_id}/send`, {
      method: "POST",
      body: JSON.stringify({ jid: conv.contact_jid, text })
    });

    const waMessageId = result?.waMessageId || `human_${Date.now()}`;
    await supabase.from("support_message").insert({
      conversation_id: params.id,
      wa_message_id: waMessageId,
      direction: "out",
      sender: "human",
      content: text
    });

    await supabase.from("support_conversation")
      .update({ last_message_at: new Date().toISOString(), status: "human_active", updated_at: new Date().toISOString() })
      .eq("id", params.id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
