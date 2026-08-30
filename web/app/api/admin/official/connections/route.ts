import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation, requireInternalAdmin } from "@/lib/internal-admin";
import { createOfficialConnection, listOfficialConnections } from "@/modules/official-whatsapp/server/official-connections";
import { ZodError } from "zod";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ connections: await listOfficialConnections() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar as contas. Tente novamente." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_connection_write");
  if (guard) return guard;
  const session = await requireInternalAdmin();
  if (session.error) return session.error;
  try {
    const result = await createOfficialConnection(await request.json(), session.session.email);
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ZodError ? "Revise os campos: IDs numéricos, token, App Secret e versão da API são obrigatórios." : error instanceof Error ? error.message : "Não foi possível conectar a conta." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
