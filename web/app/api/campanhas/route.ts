import { NextRequest, NextResponse } from "next/server";
import { createCampanhaSchema, updateCampanhaSchema } from "@/lib/schemas";
import { validateGroupJid } from "@/lib/phone";
import { guardAdminMutation } from "@/lib/security";
import { requireTenantDatabase } from "@/lib/tenant-database";
import { createCampaign, deleteCampaign, listCampaigns, updateCampaign } from "@/modules/campaigns/server/campaign-service";
import { badRequest, serverError } from "@/shared/http/responses";

function uniqueValidGroups(groupJids: string[]) {
  const groups = Array.from(new Set(groupJids));
  return groups.every(validateGroupJid) ? groups : null;
}

export async function GET() {
  const tenant = await requireTenantDatabase();
  if (tenant.error) return tenant.error;
  try { return NextResponse.json(await listCampaigns(tenant.database, tenant.accountId)); }
  catch (error) { return serverError(error, "Não foi possível carregar as campanhas."); }
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const tenant = await requireTenantDatabase();
  if (tenant.error) return tenant.error;
  const parsed = createCampanhaSchema.safeParse(await request.json());
  if (!parsed.success) return badRequest("Campanha inválida.");
  const groupJids = uniqueValidGroups(parsed.data.group_jids);
  if (!groupJids) return badRequest("Grupo inválido.");
  try {
    return NextResponse.json(await createCampaign(tenant.database, tenant.accountId, {
      nome: parsed.data.nome, groupJids, senderId: parsed.data.whatsapp_sender_id || null
    }));
  } catch (error) { return serverError(error, "Não foi possível criar a campanha."); }
}

export async function PATCH(request: NextRequest) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const tenant = await requireTenantDatabase();
  if (tenant.error) return tenant.error;
  const parsed = updateCampanhaSchema.safeParse(await request.json());
  if (!parsed.success) return badRequest("Campanha inválida.");
  const groupJids = parsed.data.group_jids ? uniqueValidGroups(parsed.data.group_jids) : undefined;
  if (groupJids === null) return badRequest("Grupo inválido.");
  try { return NextResponse.json(await updateCampaign(tenant.database, tenant.accountId, { ...parsed.data, group_jids: groupJids })); }
  catch (error) { return serverError(error, "Não foi possível atualizar a campanha."); }
}

export async function DELETE(request: NextRequest) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const tenant = await requireTenantDatabase();
  if (tenant.error) return tenant.error;
  const id = String((await request.json().catch(() => ({}))).id || "");
  if (!id) return badRequest("Campanha inválida.");
  try { return NextResponse.json(await deleteCampaign(tenant.database, tenant.accountId, id)); }
  catch (error) { return serverError(error, "Não foi possível excluir a campanha."); }
}
