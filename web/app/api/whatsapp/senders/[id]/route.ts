import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

const activeStatuses = ["pendente", "enfileirado", "processando", "pausado", "incerto"];

function failure(error: { message?: string } | null | undefined, fallback: string) {
  return NextResponse.json({ error: error?.message || fallback }, { status: 500 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardAdminMutation(request, "whatsapp_senders");
  if (guard) return guard;

  const sb = supabaseAdmin();
  const { data: sender, error: senderError } = await sb.from("whatsapp_senders").select("*").eq("id", id).maybeSingle();
  if (senderError) return NextResponse.json({ error: senderError.message }, { status: 500 });
  if (!sender) return NextResponse.json({ error: "Número não encontrado." }, { status: 404 });

  await callWhatsappService(`/senders/${sender.session_name}/disconnect`, { method: "POST" }).catch(() => undefined);

  const now = new Date().toISOString();
  const cancellation = "Envio cancelado porque o número responsável foi excluído.";

  const directCancellation = await sb.from("envios").update({
    status: "erro",
    erro: cancellation,
    resolution_note: cancellation,
    resolved_at: now,
    claim_token: null,
    updated_at: now
  }).eq("whatsapp_sender_id", sender.id).in("status", activeStatuses);
  if (directCancellation.error) return failure(directCancellation.error, "Falha ao cancelar os envios pendentes deste número.");

  const groupCancellation = await sb.from("envios_grupo").update({
    status: "erro",
    erro: cancellation,
    resolution_note: cancellation,
    resolved_at: now,
    claim_token: null,
    updated_at: now
  }).eq("whatsapp_sender_id", sender.id).in("status", activeStatuses);
  if (groupCancellation.error) return failure(groupCancellation.error, "Falha ao cancelar os envios para grupos deste número.");

  const batchCancellation = await sb.from("envios_grupo_lotes").update({
    status: "cancelado",
    finished_at: now,
    updated_at: now
  }).eq("whatsapp_sender_id", sender.id).in("status", activeStatuses);
  if (batchCancellation.error) return failure(batchCancellation.error, "Falha ao cancelar os lotes deste número.");

  const references = [
    await sb.from("campanhas").update({ whatsapp_sender_id: null, updated_at: now }).eq("whatsapp_sender_id", sender.id),
    await sb.from("envios").update({ whatsapp_sender_id: null }).eq("whatsapp_sender_id", sender.id),
    await sb.from("envios_grupo").update({ whatsapp_sender_id: null }).eq("whatsapp_sender_id", sender.id),
    await sb.from("envios_grupo_lotes").update({ whatsapp_sender_id: null }).eq("whatsapp_sender_id", sender.id),
    await sb.from("whatsapp_sender_grupos").delete().eq("whatsapp_sender_id", sender.id)
  ];
  const referenceError = references.find((result) => result.error)?.error;
  if (referenceError) return failure(referenceError, "Falha ao remover os vínculos deste número.");

  const [keys, creds] = await Promise.all([
    sb.from("whatsapp_auth_keys").delete().eq("session_name", sender.session_name),
    sb.from("whatsapp_auth_creds").delete().eq("session_name", sender.session_name)
  ]);
  if (keys.error || creds.error) return failure(keys.error || creds.error, "Falha ao remover a conexão deste número.");

  const { error: deleteError } = await sb.from("whatsapp_senders").delete().eq("id", sender.id);
  if (deleteError) return failure(deleteError, "Falha ao excluir o número.");

  return NextResponse.json({ ok: true });
}
