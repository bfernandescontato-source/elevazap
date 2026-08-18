import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { updateQuickReplyActionActive } from "@/modules/official-whatsapp/server/quick-reply-actions";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardInternalAdminMutation(request, "official_quick_reply_write_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as { active?: boolean } | null;
  if (typeof body?.active !== "boolean") return NextResponse.json({ error: "Informe 'active'." }, { status: 400 });

  try {
    const action = await updateQuickReplyActionActive(id, body.active);
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao atualizar." }, { status: 500 });
  }
}
