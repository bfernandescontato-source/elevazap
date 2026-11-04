import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

const schema = z.object({ phone_number: z.string().trim().min(10).max(25) });

/** Conectar o número digitando um código no celular, sem escanear o QR. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardAdminMutation(request, "whatsapp_senders");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Informe o número com DDD." }, { status: 400 });
  // número do Brasil sem o 55: completa
  const digits = parsed.data.phone_number.replace(/\D/g, "");
  const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  const { data: sender } = await supabaseAdmin().from("whatsapp_senders").select("session_name").eq("id", id).eq("account_id", context.accountId).maybeSingle();
  if (!sender) return NextResponse.json({ error: "Número não encontrado." }, { status: 404 });
  try {
    return NextResponse.json(await callWhatsappService(`/senders/${sender.session_name}/pairing-code`, { method: "POST", body: JSON.stringify({ phone_number: phone }) }));
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Não foi possível gerar o código agora." }, { status: 503 });
  }
}
