import { NextRequest, NextResponse } from "next/server";
import { syncCampaignGroupInviteLinks } from "@/lib/campaign-group-sync";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await params;

  try {
    return NextResponse.json({ ok: true, ...(await syncCampaignGroupInviteLinks(context.accountId, id)) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Não foi possível atualizar os links dos grupos." }, { status: 500 });
  }
}
