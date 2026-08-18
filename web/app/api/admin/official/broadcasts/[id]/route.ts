import { NextRequest, NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { getBroadcast, listBroadcastRecipients } from "@/modules/official-whatsapp/server/broadcasts";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;

  const broadcast = await getBroadcast(id);
  if (!broadcast) return NextResponse.json({ error: "Disparo não encontrado." }, { status: 404 });

  const statusFilter = request.nextUrl.searchParams.get("status") || "all";
  const recipients = await listBroadcastRecipients(id, statusFilter);
  return NextResponse.json({ broadcast, recipients });
}
