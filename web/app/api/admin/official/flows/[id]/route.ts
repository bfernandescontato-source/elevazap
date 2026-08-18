import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { parseFlowInput, updateFlow, updateFlowActive } from "@/modules/official-whatsapp/server/flows";

// Toggle simples ({active}) ou edição completa (mesmo formato do POST de criação) — o corpo
// decide: se vier "name", é edição completa; senão, só liga/desliga o fluxo.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardInternalAdminMutation(request, "official_flow_write_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as Record<string, any> | null;

  if (body?.name === undefined) {
    if (typeof body?.active !== "boolean") return NextResponse.json({ error: "Informe 'active'." }, { status: 400 });
    try {
      const flow = await updateFlowActive(id, body.active);
      return NextResponse.json({ ok: true, flow });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao atualizar." }, { status: 500 });
    }
  }

  const parsed = parseFlowInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const flow = await updateFlow(id, parsed);
    return NextResponse.json({ ok: true, flow });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao atualizar." }, { status: 500 });
  }
}
