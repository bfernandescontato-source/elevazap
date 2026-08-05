import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { normalizeBrazilianPhone, maskPhone } from "@/lib/phone";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { defaultApprovedPurchaseMessage, renderApprovedPurchaseMessage } from "@/lib/message-template";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const phone = normalizeBrazilianPhone(env().MEU_NUMERO_TESTE);
  const { data: config } = await supabaseAdmin().from("config").select("welcome_message").eq("account_id", context.accountId).limit(1).maybeSingle();
  const message = renderApprovedPurchaseMessage(config?.welcome_message || defaultApprovedPurchaseMessage, {
    nome: "Teste",
    produto: "Produto teste",
    email: "teste@local",
    telefone: phone,
    order_id: "pedido_teste",
    transaction_id: "transacao_teste"
  });
  const { error } = await supabaseAdmin().from("envios").insert({ account_id: context.accountId, source: "teste", nome: "Teste", telefone: phone, telefone_mascarado: maskPhone(phone), produto: "Teste", email: "teste@local", mensagem_enviada: message, status: "pendente" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
