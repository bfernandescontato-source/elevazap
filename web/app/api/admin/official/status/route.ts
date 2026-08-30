import { NextRequest, NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { testMetaConnection } from "@/modules/official-whatsapp/server/connection";

export async function GET(request: NextRequest) {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  try {
    const status = await testMetaConnection(request.nextUrl.searchParams.get("connectionId"));
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: "Não foi possível testar esta conta." }, { status: 400 });
  }
}
