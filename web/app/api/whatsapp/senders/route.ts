import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

async function withStatus(sender: any) {
  const status = await callWhatsappService(`/senders/${sender.session_name}/status`).catch(() => ({ status: "disconnected", qr: "" }));
  return { ...sender, ...status };
}

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { data, error } = await supabaseAdmin().from("whatsapp_senders").select("*").eq("account_id", context.accountId).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ senders: await Promise.all((data || []).map(withStatus)) });
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "whatsapp_senders");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const body = await request.json().catch(() => ({}));
  const label = String(body.label || "").trim();
  if (!label) return NextResponse.json({ error: "Informe um nome para o número." }, { status: 400 });
  const sessionName = `sender_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const { data, error } = await supabaseAdmin().from("whatsapp_senders").insert({ label, session_name: sessionName, account_id: context.accountId }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    const connection = await callWhatsappService(`/senders/${sessionName}/connect`, { method: "POST" });
    return NextResponse.json({ sender: { ...data, ...connection } }, { status: 201 });
  } catch (connectionError: any) {
    return NextResponse.json({
      error: connectionError?.message || "O número foi salvo, mas o serviço não conseguiu gerar o QR Code.",
      sender: data
    }, { status: 503 });
  }
}
