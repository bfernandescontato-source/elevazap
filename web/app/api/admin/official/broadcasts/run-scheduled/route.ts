import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runDueScheduledBroadcasts } from "@/modules/official-whatsapp/server/broadcasts";

function internalKeyValid(provided: string | null, expected: string) {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Chamado pelo poller de web/instrumentation.ts (setInterval no processo do Next). Promove pra
// "processing" qualquer disparo 1x1 agendado cujo horário já chegou. Mesmo padrão de autenticação
// de process-batch: chave interna, não sessão de admin, porque quem chama é o próprio servidor.
export async function POST(request: NextRequest) {
  if (!internalKeyValid(request.headers.get("x-internal-api-key"), env().INTERNAL_API_KEY)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  await runDueScheduledBroadcasts();
  return NextResponse.json({ ok: true });
}
