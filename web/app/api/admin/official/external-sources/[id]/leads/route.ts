import { NextRequest, NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { getExternalSource } from "@/modules/official-whatsapp/server/external-sources";
import { listExternalLeads } from "@/modules/official-whatsapp/server/external-leads";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;

  const source = await getExternalSource(id);
  if (!source) return NextResponse.json({ error: "Entrada não encontrada." }, { status: 404 });

  const statusFilter = request.nextUrl.searchParams.get("status") || "all";
  const leads = await listExternalLeads(id, statusFilter);
  return NextResponse.json({ source, leads });
}
