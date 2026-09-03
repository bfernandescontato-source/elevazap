import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { cancelScheduledBroadcast } from "@/modules/official-whatsapp/server/broadcasts";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardInternalAdminMutation(request, "official_broadcast_write_ip");
  if (guard) return guard;
  try {
    await cancelScheduledBroadcast(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao cancelar agendamento." }, { status: 400 });
  }
}
