import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runDueOfficialFollowups } from "@/modules/official-whatsapp/server/automation-followups-cron";

export const maxDuration = 300;

// Único gatilho para etapas de sequência disparadas por atraso: chamado pelo Vercel Cron (ver
// vercel.json) uma vez por minuto. Mesma autenticação de run-scheduled/route.ts — a Vercel injeta
// "Authorization: Bearer <CRON_SECRET>" automaticamente nas invocações de cron.
export async function GET(request: NextRequest) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const result = await runDueOfficialFollowups();
  return NextResponse.json({ ok: true, ...result });
}
