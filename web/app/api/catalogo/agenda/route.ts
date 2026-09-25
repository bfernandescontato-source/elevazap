import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { agendaCancelSchema, agendaQuerySchema, agendaRescheduleSchema } from "@/modules/affiliate-catalog/schemas";
import { cancelCatalogOffer, isCatalogAgendaEnabled, listCatalogAgenda, rescheduleCatalogOffer } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { CatalogDispatchError } from "@/modules/affiliate-catalog/server/catalog-dispatch-service";

const disabled = () => NextResponse.json({ error: "A Agenda do Catálogo ainda não está liberada para sua conta." }, { status: 403 });
const failure = (error: unknown) => {
  if (error instanceof CatalogDispatchError) return NextResponse.json({ error: error.message }, { status: error.status });
  throw error;
};

export async function GET(request: NextRequest) {
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isCatalogAgendaEnabled(context.accountId)) return disabled();
  const parsed = agendaQuerySchema.safeParse({ day: request.nextUrl.searchParams.get("day") });
  if (!parsed.success) return NextResponse.json({ error: "Data inválida." }, { status: 400 });
  try { return NextResponse.json({ items: await listCatalogAgenda(context.accountId, parsed.data.day) }); }
  catch (error) { return failure(error); }
}

// Um ou vários horários de uma vez (mudar horário, amanhã, enviar agora,
// espalhar, começar agora, redistribuir). Cada mudança volta com seu resultado.
export async function PATCH(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_agenda_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isCatalogAgendaEnabled(context.accountId)) return disabled();
  const parsed = agendaRescheduleSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  const results = [];
  for (const change of parsed.data.changes) {
    try { await rescheduleCatalogOffer(context.accountId, change.id, change.scheduledAt); results.push({ id: change.id, ok: true }); }
    catch (error) {
      if (!(error instanceof CatalogDispatchError)) throw error;
      results.push({ id: change.id, ok: false, error: error.message });
    }
  }
  return NextResponse.json({ results });
}

export async function DELETE(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_agenda_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isCatalogAgendaEnabled(context.accountId)) return disabled();
  const parsed = agendaCancelSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Oferta inválida." }, { status: 400 });
  try { await cancelCatalogOffer(context.accountId, parsed.data.id); return NextResponse.json({ ok: true }); }
  catch (error) { return failure(error); }
}
