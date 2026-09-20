import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

export const maxDuration = 60;

function failure(error: { message?: string } | null | undefined, fallback: string) {
  return NextResponse.json({ error: error?.message || fallback }, { status: 500 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardAdminMutation(request, "whatsapp_senders");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;

  const sb = supabaseAdmin();
  const { data: sender, error: senderError } = await sb.from("whatsapp_senders").select("*").eq("id", id).eq("account_id", context.accountId).maybeSingle();
  if (senderError) return NextResponse.json({ error: senderError.message }, { status: 500 });
  if (!sender) return NextResponse.json({ error: "Número não encontrado." }, { status: 404 });

  // Cada etapa é uma chamada (e uma transação) separada, com o seu próprio limite
  // de tempo do banco: juntas passavam de 8 s em contas com muito histórico.
  // São idempotentes, e a última também repete as anteriores por segurança.
  for (const step of ["cancel_whatsapp_sender_pending_work", "cancel_whatsapp_sender_pending_batches", "delete_whatsapp_sender"] as const) {
    const { error: stepError } = await sb.rpc(step, { p_account_id: context.accountId, p_sender_id: sender.id });
    if (stepError) return failure(stepError, "Falha ao excluir o número.");
  }

  await callWhatsappService(`/senders/${sender.session_name}/disconnect`, { method: "POST" }).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
