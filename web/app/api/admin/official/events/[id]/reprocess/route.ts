import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { getHublaEventById } from "@/modules/official-whatsapp/server/hubla-events";
import { parseHublaEvent } from "@/modules/official-whatsapp/server/hubla-parser";
import { processHublaEvent } from "@/modules/official-whatsapp/server/hubla-processor";

// Reenvio manual: reaproveita o mesmo processHublaEvent() do fluxo automático — a garantia de
// correção vem de reusar o pipeline já testado, não de duplicar lógica. Cada chamada gera uma
// nova tentativa em official_messages, sem apagar o histórico anterior.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardInternalAdminMutation(request, "official_event_reprocess_ip");
  if (guard) return guard;

  const event = await getHublaEventById(id);
  if (!event) return NextResponse.json({ error: "Evento não encontrado." }, { status: 404 });
  if (!["failed", "ignored"].includes(event.status)) {
    return NextResponse.json({ error: "Só é possível reenviar eventos com status 'failed' ou 'ignored'." }, { status: 400 });
  }

  const parsed = parseHublaEvent(event.payload);
  await processHublaEvent(id, parsed);
  return NextResponse.json({ ok: true });
}
