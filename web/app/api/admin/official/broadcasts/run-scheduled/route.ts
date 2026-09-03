import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runDueScheduledBroadcasts } from "@/modules/official-whatsapp/server/broadcasts";

export const maxDuration = 300;

// Único gatilho para disparos 1x1 agendados: chamado pelo Vercel Cron (ver vercel.json) uma vez
// por minuto. A Vercel injeta "Authorization: Bearer <CRON_SECRET>" automaticamente nas
// invocações de cron quando a env var CRON_SECRET está configurada no projeto — é assim que
// autenticamos, sem sessão de admin nem o INTERNAL_API_KEY usado pelas rotas chamadas pelo
// próprio servidor (aqui quem chama é a infraestrutura da Vercel).
export async function GET(request: NextRequest) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const result = await runDueScheduledBroadcasts();
  return NextResponse.json({ ok: true, ...result });
}
