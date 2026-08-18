import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { testMetaConnection } from "@/modules/official-whatsapp/server/connection";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const status = await testMetaConnection();
  return NextResponse.json(status);
}
