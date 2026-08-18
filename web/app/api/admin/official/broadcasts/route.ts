import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { guardInternalAdminMutation, requireInternalAdmin } from "@/lib/internal-admin";
import { classifyContacts, type RawContact } from "@/modules/official-whatsapp/server/broadcast-contacts";
import { createBroadcastAndStart, listBroadcasts, triggerBatchProcessing } from "@/modules/official-whatsapp/server/broadcasts";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const broadcasts = await listBroadcasts();
  return NextResponse.json({ broadcasts });
}

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_broadcast_start_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as { name?: string; flowId?: string; contacts?: RawContact[]; skipRecipientsWithPriorRun?: boolean } | null;
  const name = String(body?.name || "").trim();
  const flowId = String(body?.flowId || "");
  const contacts = Array.isArray(body?.contacts) ? body!.contacts! : [];
  if (!name || !flowId || !contacts.length) return NextResponse.json({ error: "Nome, fluxo e contatos são obrigatórios." }, { status: 400 });

  const classified = classifyContacts(contacts);
  if (!classified.validContacts.length) return NextResponse.json({ error: "Nenhum contato válido na lista." }, { status: 400 });

  try {
    const result = await createBroadcastAndStart({
      name, flowId, contacts: classified.validContacts, skipRecipientsWithPriorRun: Boolean(body?.skipRecipientsWithPriorRun)
    });
    after(() => triggerBatchProcessing(result.broadcastId));
    return NextResponse.json({ ok: true, broadcastId: result.broadcastId, validCount: classified.validCount, duplicateCount: classified.duplicateCount, invalidCount: classified.invalidCount, skippedForPriorRun: result.skippedForPriorRun });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao iniciar disparo." }, { status: 500 });
  }
}
