import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { listTemplates } from "@/modules/official-whatsapp/server/templates";
import { OFFICIAL_ERROR_LABELS, officialErrorCode } from "@/modules/official-whatsapp/server/errors";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  try {
    const templates = await listTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    const code = officialErrorCode(error);
    return NextResponse.json({ error: OFFICIAL_ERROR_LABELS[code], code }, { status: 502 });
  }
}
