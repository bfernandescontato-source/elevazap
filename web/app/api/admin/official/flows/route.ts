import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation, requireInternalAdmin } from "@/lib/internal-admin";
import { createFlow, listFlows, parseFlowInput } from "@/modules/official-whatsapp/server/flows";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const flows = await listFlows();
  return NextResponse.json({ flows });
}

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_flow_write_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as Record<string, any> | null;
  const parsed = parseFlowInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const flow = await createFlow(parsed);
    return NextResponse.json({ ok: true, flow });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao criar fluxo." }, { status: 500 });
  }
}
