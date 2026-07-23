import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminMutation(request, "whatsapp_senders");
  if (guard) return guard;
  const sb = supabaseAdmin();
  const { data: sender } = await sb.from("whatsapp_senders").select("*").eq("id", params.id).maybeSingle();
  if (!sender) return NextResponse.json({ error: "Número não encontrado." }, { status: 404 });
  const result = await callWhatsappService(`/senders/${sender.session_name}/refresh-groups`, { method: "POST" });
  const groups = result.groups || [];
  if (groups.length) {
    const linked = await sb
      .from("whatsapp_sender_grupos")
      .upsert(
        groups.map((group: any) => ({
          whatsapp_sender_id: sender.id,
          group_jid: group.group_jid,
          updated_at: new Date().toISOString()
        })),
        { onConflict: "whatsapp_sender_id,group_jid" }
      );
    if (linked.error) return NextResponse.json({ error: linked.error.message }, { status: 500 });
  }
  return NextResponse.json(result);
}
