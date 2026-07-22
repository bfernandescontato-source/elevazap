import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

const activeStatuses = ["pendente", "enfileirado", "processando", "pausado", "incerto"];

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminMutation(request, "whatsapp_senders");
  if (guard) return guard;

  const sb = supabaseAdmin();
  const { data: sender, error: senderError } = await sb.from("whatsapp_senders").select("*").eq("id", params.id).maybeSingle();
  if (senderError) return NextResponse.json({ error: senderError.message }, { status: 500 });
  if (!sender) return NextResponse.json({ error: "Número não encontrado." }, { status: 404 });

  const [{ count: directCount, error: directError }, { count: groupCount, error: groupError }] = await Promise.all([
    sb.from("envios").select("id", { count: "exact", head: true }).eq("whatsapp_sender_id", sender.id).in("status", activeStatuses),
    sb.from("envios_grupo").select("id", { count: "exact", head: true }).eq("whatsapp_sender_id", sender.id).in("status", activeStatuses)
  ]);
  if (directError || groupError) return NextResponse.json({ error: directError?.message || groupError?.message }, { status: 500 });
  if ((directCount || 0) + (groupCount || 0) > 0) {
    return NextResponse.json({ error: `Este número possui ${(directCount || 0) + (groupCount || 0)} disparo(s) pendente(s). Conclua ou cancele esses envios antes de excluir.` }, { status: 409 });
  }

  await callWhatsappService(`/senders/${sender.session_name}/disconnect`, { method: "POST" }).catch(() => undefined);

  const { error: deleteError } = await sb.from("whatsapp_senders").delete().eq("id", sender.id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  await Promise.all([
    sb.from("whatsapp_auth_keys").delete().eq("session_name", sender.session_name),
    sb.from("whatsapp_auth_creds").delete().eq("session_name", sender.session_name)
  ]);

  return NextResponse.json({ ok: true });
}
