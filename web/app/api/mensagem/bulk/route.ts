import { NextRequest, NextResponse } from "next/server";
import { maskPhone, normalizeBrazilianPhone } from "@/lib/phone";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { bulkMensagemSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase";
import { renderApprovedPurchaseMessage } from "@/lib/message-template";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "mensagem_bulk");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;

  const parsed = bulkMensagemSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Lista inválida." }, { status: 400 });
  }
  if (parsed.data.scheduled_at && new Date(parsed.data.scheduled_at).getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: "Agendamento no passado." }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: sender } = parsed.data.whatsapp_sender_id
    ? await sb.from("whatsapp_senders").select("*").eq("id", parsed.data.whatsapp_sender_id).eq("account_id", context.accountId).maybeSingle()
    : { data: null };
  if (parsed.data.whatsapp_sender_id && !sender) {
    return NextResponse.json({ error: "Número responsável pelo disparo não encontrado." }, { status: 400 });
  }

  const rows = [];
  const errors = [];
  for (const [index, cliente] of parsed.data.clientes.entries()) {
    try {
      const telefone = normalizeBrazilianPhone(cliente.telefone);
      const produto = cliente.produto || "Disparo manual";
      rows.push({
        account_id: context.accountId,
        source: "massa_manual",
        event: "manual.bulk",
        nome: cliente.nome,
        telefone,
        telefone_mascarado: maskPhone(telefone),
        produto,
        email: cliente.email || null,
        order_id: cliente.order_id || null,
        transaction_id: cliente.transaction_id || null,
        ...(sender ? { whatsapp_sender_id: sender.id, whatsapp_session_name: sender.session_name } : {}),
        ...(parsed.data.scheduled_at ? { scheduled_at: parsed.data.scheduled_at } : {}),
        mensagem_enviada: renderApprovedPurchaseMessage(parsed.data.mensagem, {
          nome: cliente.nome,
          produto,
          email: cliente.email || "",
          telefone,
          order_id: cliente.order_id || "",
          transaction_id: cliente.transaction_id || ""
        }),
        status: "pendente"
      });
    } catch (error: any) {
      errors.push({ linha: index + 2, nome: cliente.nome, telefone: cliente.telefone, error: error.message });
    }
  }

  if (!rows.length) return NextResponse.json({ error: "Nenhum cliente válido para enfileirar.", errors }, { status: 400 });
  const { error } = await sb.from("envios").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, enfileirados: rows.length, erros: errors.length, errors });
}
