import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminMutation(request, "whatsapp_senders");
  if (guard) return guard;
  const { data: sender } = await supabaseAdmin().from("whatsapp_senders").select("*").eq("id", params.id).maybeSingle();
  if (!sender) return NextResponse.json({ error: "Número não encontrado." }, { status: 404 });
  try {
    return NextResponse.json(await callWhatsappService(`/senders/${sender.session_name}/connect`, { method: "POST" }));
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Não foi possível gerar o QR Code deste número." }, { status: 503 });
  }
}
