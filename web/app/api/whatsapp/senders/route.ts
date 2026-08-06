import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";
import { getPlanLimits, getPlanLabel, UNLIMITED_SENDERS } from "@/lib/plans";

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

  // Verificação de limite do plano
  const sb = supabaseAdmin();
  const { count } = await sb.from("whatsapp_senders")
    .select("*", { count: "exact", head: true })
    .eq("account_id", context.accountId);
  const currentCount = count ?? 0;
  const limits = getPlanLimits(context.account?.plan ?? "default");
  if (limits.maxSenders < UNLIMITED_SENDERS && currentCount >= limits.maxSenders) {
    const planLabel = getPlanLabel(context.account?.plan ?? "default");
    return NextResponse.json({
      error: `Seu plano ${planLabel} permite até ${limits.maxSenders} número(s) de WhatsApp. Remova um número existente ou faça upgrade do plano para adicionar mais.`,
      code: "plan_limit_reached",
      limit: limits.maxSenders,
      current: currentCount,
    }, { status: 403 });
  }

  const sessionName = `sender_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const { data, error } = await sb.from("whatsapp_senders").insert({ label, session_name: sessionName, account_id: context.accountId }).select("*").single();
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
