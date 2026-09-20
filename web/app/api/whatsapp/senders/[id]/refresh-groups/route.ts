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
  const sb = supabaseAdmin();
  const { data: sender } = await sb.from("whatsapp_senders").select("*").eq("id", id).eq("account_id", context.accountId).maybeSingle();
  if (!sender) return NextResponse.json({ error: "Número não encontrado." }, { status: 404 });
  const result = await callWhatsappService(`/senders/${sender.session_name}/refresh-groups`, { method: "POST" });
  const groups = result.groups || [];
  if (groups.length) {
    const linked = await sb
      .from("whatsapp_sender_grupos")
      .upsert(
        groups.map((group: any) => ({
          whatsapp_sender_id: sender.id,
          account_id: context.accountId,
          group_jid: group.group_jid,
          updated_at: new Date().toISOString()
        })),
        { onConflict: "whatsapp_sender_id,group_jid" }
      );
    if (linked.error) return NextResponse.json({ error: linked.error.message }, { status: 500 });

    // A leitura acabou de dar certo (o serviço lança erro se não conseguir listar),
    // então o que não veio nela é grupo que o número deixou de ter: sai da lista e
    // dos destinos do Piloto, senão os envios voltam "forbidden" e travam o número.
    const pruned = await sb.rpc("prune_sender_groups", {
      p_account_id: context.accountId,
      p_sender_id: sender.id,
      p_group_jids: groups.map((group: any) => group.group_jid).filter(Boolean)
    });
    if (pruned.error) console.warn({ event: "prune_sender_groups_failed", sender_id: sender.id, message: pruned.error.message });
    return NextResponse.json({ ...result, removed_groups: pruned.error ? 0 : pruned.data ?? 0 });
  }
  return NextResponse.json(result);
}
