import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { parseExternalSourceInput, updateExternalSource } from "@/modules/official-whatsapp/server/external-sources";

// Toggle simples ({active}) ou edição completa (mesmo formato do POST de criação) — igual ao
// padrão já usado em /api/admin/official/flows/[id]. Nunca altera o secret aqui.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardInternalAdminMutation(request, "official_external_source_write_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as Record<string, any> | null;

  if (body?.name === undefined) {
    if (typeof body?.active !== "boolean") return NextResponse.json({ error: "Informe 'active'." }, { status: 400 });
    try {
      const source = await updateExternalSource(id, { active: body.active });
      return NextResponse.json({ ok: true, source });
    } catch {
      return NextResponse.json({ error: "Falha ao atualizar." }, { status: 500 });
    }
  }

  const parsed = parseExternalSourceInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const source = await updateExternalSource(id, { name: parsed.name, sourceKey: parsed.sourceKey, flowId: parsed.flowId, fixedContentName: parsed.fixedContentName });
    return NextResponse.json({ ok: true, source });
  } catch (error) {
    const message = error instanceof Error && /duplicate|unique/i.test(error.message) ? "Já existe uma entrada com essa source key." : "Falha ao atualizar.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
