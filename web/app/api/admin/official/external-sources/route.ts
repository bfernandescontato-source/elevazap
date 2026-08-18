import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation, requireInternalAdmin } from "@/lib/internal-admin";
import { createExternalSource, listExternalSources, parseExternalSourceInput } from "@/modules/official-whatsapp/server/external-sources";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const sources = await listExternalSources();
  return NextResponse.json({ sources });
}

// O secret é devolvido em texto puro só nesta resposta — o admin precisa copiar agora,
// o backend nunca mais expõe o valor depois disto (só o hash fica salvo).
export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_external_source_write_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as Record<string, any> | null;
  const parsed = parseExternalSourceInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const { source, secret } = await createExternalSource(parsed);
    return NextResponse.json({ ok: true, source, secret });
  } catch (error) {
    const message = error instanceof Error && /duplicate|unique/i.test(error.message) ? "Já existe uma entrada com essa source key." : "Falha ao criar entrada externa.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
