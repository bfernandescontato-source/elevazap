import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { syncCampaignGroups } from "@/lib/campaign-group-sync";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ ok: true, groups: await syncCampaignGroups(id) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha ao atualizar participantes." }, { status: 503 });
  }
}
