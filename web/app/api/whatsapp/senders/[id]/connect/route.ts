import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardAdminMutation(request, "whatsapp_senders");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { data: sender } = await supabaseAdmin().from("whatsapp_senders").select("*").eq("id", id).eq("account_id", context.accountId).maybeSingle();
  if (!sender) return NextResponse.json({ error: "Número não encontrado." }, { status: 404 });
  try {
    return NextResponse.json(await callWhatsappService(`/senders/${sender.session_name}/connect`, { method: "POST" }));
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Não foi possível gerar o QR Code deste número." }, { status: 503 });
  }
}
