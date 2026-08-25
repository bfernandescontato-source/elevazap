import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";
import { validateGroupJid } from "@/lib/phone";

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeFileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "grupo";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ jid: string }> }) {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const groupJid = decodeURIComponent((await params).jid);
  const senderId = request.nextUrl.searchParams.get("sender_id");
  if (!validateGroupJid(groupJid) || !senderId) return NextResponse.json({ error: "Grupo ou número inválido." }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: link } = await sb.from("whatsapp_sender_grupos")
    .select("group_jid,whatsapp_senders!inner(id,session_name,account_id)")
    .eq("account_id", context.accountId)
    .eq("whatsapp_sender_id", senderId)
    .eq("group_jid", groupJid)
    .maybeSingle();
  const sender = Array.isArray((link as any)?.whatsapp_senders) ? (link as any).whatsapp_senders[0] : (link as any)?.whatsapp_senders;
  if (!link || !sender || sender.account_id !== context.accountId) return NextResponse.json({ error: "Grupo não encontrado para este número." }, { status: 404 });

  try {
    const result = await callWhatsappService(`/senders/${sender.session_name}/groups/contacts`, {
      method: "POST",
      body: JSON.stringify({ groupJid })
    });
    const rows = [
      ["telefone", "whatsapp_id", "funcao", "grupo"],
      ...(Array.isArray(result.contacts) ? result.contacts : []).map((contact: any) => [contact.phone, contact.whatsapp_id, contact.role, result.group_name])
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const filename = `contatos-${safeFileName(result.group_name || groupJid)}.csv`;
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível baixar os contatos." }, { status: 503 });
  }
}
