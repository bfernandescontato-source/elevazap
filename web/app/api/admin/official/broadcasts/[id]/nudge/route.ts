import { NextRequest, NextResponse } from "next/server";
import { clientIp, persistentRateLimit, requireValidOrigin } from "@/lib/security";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { nudgeBroadcastIfStalled } from "@/modules/official-whatsapp/server/broadcasts";

// Chamado pelo poll da tela de progresso (a cada 2.5s enquanto status === "processing").
// Limite próprio (mais generoso que o de pause/resume) porque é esperado ser chamado com
// frequência — na prática só age quando o encadeamento via after() realmente parou.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const allowed = await persistentRateLimit(clientIp(request), "official_broadcast_nudge_ip", 60, 60);
  if (!allowed) return NextResponse.json({ error: "Muitas tentativas. Aguarde um pouco." }, { status: 429 });

  const result = await nudgeBroadcastIfStalled(id);
  return NextResponse.json(result);
}
