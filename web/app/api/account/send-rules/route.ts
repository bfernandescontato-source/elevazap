import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { sendRulesSchema } from "@/modules/send-guard/rules";
import { getSendRules, saveSendRules } from "@/modules/send-guard/server/send-rules-service";

// Regras de envio da conta (pausa noturna e produto repetido). Lê e grava com o
// cliente da sessão: a RLS e o filtro de conta garantem que é só a conta logada.
export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  try {
    const rules = await getSendRules(context.accountId, context.database);
    return NextResponse.json({ rules, canEdit: context.session.role === "admin" });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar as regras de envio." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const guard = await guardAdminMutation(request, "send_rules_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = sendRulesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Regras inválidas." }, { status: 400 });
  try {
    const current = await getSendRules(context.accountId, context.database);
    if (!current.available) return NextResponse.json({ error: "Esta opção ainda não está disponível para sua conta." }, { status: 409 });
    const rules = await saveSendRules(context.database, context.accountId, context.session.userId ?? null, parsed.data);
    return NextResponse.json({ rules });
  } catch {
    return NextResponse.json({ error: "Não foi possível salvar as regras de envio." }, { status: 500 });
  }
}
