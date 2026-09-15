import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runDueMetaRelayJobs } from "@/modules/official-whatsapp/server/meta-relay";

export const maxDuration = 300;

// Cron interno: a Vercel envia CRON_SECRET; esta rota nunca fica disponível ao público.
export async function GET(request: NextRequest) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await runDueMetaRelayJobs()) });
}
