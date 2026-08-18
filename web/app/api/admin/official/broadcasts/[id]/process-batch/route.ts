import { timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { processBroadcastBatch, triggerBatchProcessing } from "@/modules/official-whatsapp/server/broadcasts";

function internalKeyValid(provided: string | null, expected: string) {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Endpoint interno — nunca chamado pelo navegador do admin. Autenticado com INTERNAL_API_KEY
// (mesmo padrão já usado para falar com o whatsapp-service), não com sessão de admin, porque
// quem chama é o próprio servidor (encadeamento via after(), ver triggerBatchProcessing).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!internalKeyValid(request.headers.get("x-internal-api-key"), env().INTERNAL_API_KEY)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const result = await processBroadcastBatch(id);
  if (result.hasMore) after(() => triggerBatchProcessing(id));
  return NextResponse.json({ ok: true, hasMore: result.hasMore });
}
