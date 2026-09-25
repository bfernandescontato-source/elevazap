import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { dispatchOfferSchema } from "@/modules/affiliate-catalog/schemas";
import { CatalogDispatchError, createCatalogDispatch, resolveCatalogTarget } from "@/modules/affiliate-catalog/server/catalog-dispatch-service";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_dispatch_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = dispatchOfferSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  const { offer, message, senderId, groupJids, scheduledAt, imageMode } = parsed.data;
  try {
    const target = await resolveCatalogTarget(context.accountId, { senderId, groupJids, imageMode });
    const result = await createCatalogDispatch({ accountId: context.accountId, userId: context.session.userId ?? null, offer, message, target, imageMode, scheduledAt });
    return NextResponse.json({ ok: true, loteId: result.loteId, total: result.total, scheduledAt: result.scheduledAt });
  } catch (error) {
    if (error instanceof CatalogDispatchError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
