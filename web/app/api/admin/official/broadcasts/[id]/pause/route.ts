import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { pauseBroadcast } from "@/modules/official-whatsapp/server/broadcasts";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardInternalAdminMutation(request, "official_broadcast_write_ip");
  if (guard) return guard;
  await pauseBroadcast(id);
  return NextResponse.json({ ok: true });
}
