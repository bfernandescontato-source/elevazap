import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { normalizeBrazilianPhone, maskPhone } from "@/lib/phone";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const phone = normalizeBrazilianPhone(env().MEU_NUMERO_TESTE);
  const { data: config } = await supabaseAdmin().from("config").select("welcome_message").limit(1).maybeSingle();
  const message = (config?.welcome_message || "Olá {{nome}}, bem-vindo(a)!").replaceAll("{{nome}}", "Teste");
  const { error } = await supabaseAdmin().from("envios").insert({ source: "teste", nome: "Teste", telefone: phone, telefone_mascarado: maskPhone(phone), produto: "Teste", email: "teste@local", mensagem_enviada: message, status: "pendente" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
