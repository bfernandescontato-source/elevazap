import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { buildCatalogOfferMessage } from "@/modules/affiliate-catalog/offer-message";
import { agendaDuplicatesSchema, bulkScheduleSchema } from "@/modules/affiliate-catalog/schemas";
import { isCatalogAgendaEnabled, scheduledItemKeys } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { CatalogDispatchError, createCatalogDispatch, resolveCatalogTarget } from "@/modules/affiliate-catalog/server/catalog-dispatch-service";

const disabled = () => NextResponse.json({ error: "A Agenda do Catálogo ainda não está liberada para sua conta." }, { status: 403 });

// Agendamento em massa: cada oferta vira um lote com a copy do modelo fixo.
// O navegador manda até 10 por vez; o resultado volta oferta por oferta, então
// uma falha não esconde as que já foram agendadas.
export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_dispatch_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isCatalogAgendaEnabled(context.accountId)) return disabled();
  const parsed = bulkScheduleSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  const { items, senderId, groupJids, imageMode } = parsed.data;
  let target;
  try { target = await resolveCatalogTarget(context.accountId, { senderId, groupJids, imageMode }); }
  catch (error) { if (error instanceof CatalogDispatchError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }

  const results = [];
  for (const { offer, scheduledAt } of items) {
    const key = `${offer.provider}:${offer.externalItemId}`;
    try {
      if (!offer.affiliateUrl) throw new CatalogDispatchError("Link afiliado ainda não gerado.", 400);
      const message = buildCatalogOfferMessage(offer, offer.affiliateUrl);
      const created = await createCatalogDispatch({ accountId: context.accountId, userId: context.session.userId ?? null, offer, message, target, imageMode, scheduledAt });
      results.push({ key, ok: true, agendaId: created.agendaId, scheduledAt: created.scheduledAt });
    } catch (error) {
      const message = error instanceof CatalogDispatchError ? error.message : "Não foi possível agendar esta oferta.";
      if (!(error instanceof CatalogDispatchError)) console.error({ event: "catalog_bulk_schedule_failed", component: "affiliate-catalog", account_id: context.accountId, key, error: error instanceof Error ? error.message : String(error) });
      results.push({ key, ok: false, error: message });
    }
  }
  return NextResponse.json({ results });
}

// Quais produtos já estão agendados no dia, para avisar antes de repetir.
export async function PUT(request: NextRequest) {
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isCatalogAgendaEnabled(context.accountId)) return disabled();
  const parsed = agendaDuplicatesSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  const keys = await scheduledItemKeys(context.accountId, parsed.data.day, parsed.data.items);
  return NextResponse.json({ scheduled: Array.from(keys) });
}
