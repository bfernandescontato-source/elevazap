import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

async function withStatus(sender: any) {
  const status = await callWhatsappService(`/senders/${sender.session_name}/status`).catch(() => ({ status: "disconnected", qr: "" }));
  return { ...sender, ...status };
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const { data, error } = await supabaseAdmin().from("whatsapp_senders").select("*").order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ senders: await Promise.all((data || []).map(withStatus)) });
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "whatsapp_senders");
  if (guard) return guard;
  const body = await request.json().catch(() => ({}));
  const label = String(body.label || "").trim();
  if (!label) return NextResponse.json({ error: "Informe um nome para o número." }, { status: 400 });
  const sessionName = `sender_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const { data, error } = await supabaseAdmin().from("whatsapp_senders").insert({ label, session_name: sessionName }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await callWhatsappService(`/senders/${sessionName}/connect`, { method: "POST" }).catch(() => undefined);
  return NextResponse.json({ sender: await withStatus(data) }, { status: 201 });
}
