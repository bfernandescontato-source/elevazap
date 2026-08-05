import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;

  const body = await request.json().catch(() => ({}));
  const inviteUrl = String(body.invite_url || "").trim();
  const senderId = body.sender_id ? String(body.sender_id) : "";
  if (!inviteUrl || inviteUrl.length > 500) return NextResponse.json({ error: "Cole um link de convite válido." }, { status: 400 });

  const sb = supabaseAdmin();
  let servicePath = "/groups/resolve-invite";
  if (senderId) {
    const { data: sender, error } = await sb.from("whatsapp_senders").select("id,session_name").eq("id", senderId).eq("account_id", context.accountId).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!sender) return NextResponse.json({ error: "Número não encontrado." }, { status: 404 });
    servicePath = `/senders/${sender.session_name}/groups/resolve-invite`;
  }

  try {
    const result = await callWhatsappService(servicePath, {
      method: "POST",
      body: JSON.stringify({ inviteUrl })
    });
    if (senderId && result.group?.group_jid) {
      const { error } = await sb.from("whatsapp_sender_grupos").upsert({
        account_id: context.accountId,
        whatsapp_sender_id: senderId,
        group_jid: result.group.group_jid,
        updated_at: new Date().toISOString()
      }, { onConflict: "whatsapp_sender_id,group_jid" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Não foi possível identificar o grupo." }, { status: 400 });
  }
}
