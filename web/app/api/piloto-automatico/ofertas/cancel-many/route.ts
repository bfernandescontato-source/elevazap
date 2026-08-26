import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { serverError } from "@/shared/http/responses";

const inputSchema = z.object({ offer_ids: z.array(z.string().uuid()).min(1).max(200) });

export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Selecione entre 1 e 200 ofertas." }, { status: 400 });

  try {
    const offerIds = Array.from(new Set(parsed.data.offer_ids));
    const { data: offers, error } = await context.database.from("captured_offers").select("id,status")
      .eq("account_id", context.accountId).in("id", offerIds);
    if (error) throw error;
    if ((offers || []).length !== offerIds.length) return NextResponse.json({ error: "Uma ou mais ofertas não foram encontradas." }, { status: 404 });
    const cancelled = (offers || []).filter((offer) => !["sent", "sending", "ignored", "duplicate"].includes(offer.status));
    const skipped = (offers || []).filter((offer) => !cancelled.some((item) => item.id === offer.id)).map((offer) => offer.id);
    const cancellableIds = cancelled.map((offer) => offer.id);
    if (!cancellableIds.length) return NextResponse.json({ ok: true, cancelled: [], skipped });

    const { data: deliveries, error: deliveriesError } = await context.database.from("offer_deliveries").select("group_dispatch_id")
      .eq("account_id", context.accountId).in("offer_id", cancellableIds);
    if (deliveriesError) throw deliveriesError;
    const dispatchIds = (deliveries || []).map((delivery) => delivery.group_dispatch_id).filter(Boolean);
    const now = new Date().toISOString();
    if (dispatchIds.length) await context.database.from("envios_grupo").update({ status: "cancelado", updated_at: now })
      .eq("account_id", context.accountId).in("id", dispatchIds).in("status", ["pendente", "enfileirado"]);
    await context.database.from("offer_deliveries").update({ status: "cancelled", error_message: "Cancelada em massa pelo usuário.", updated_at: now })
      .eq("account_id", context.accountId).in("offer_id", cancellableIds).in("status", ["pending", "scheduled"]);
    await context.database.from("captured_offers").update({ status: "ignored", error_code: "CANCELLED_BY_USER", error_message: "Cancelada em massa pelo usuário.", updated_at: now })
      .eq("account_id", context.accountId).in("id", cancellableIds);
    return NextResponse.json({ ok: true, cancelled: cancellableIds, skipped });
  } catch (error) { return serverError(error, "Não foi possível cancelar as ofertas selecionadas."); }
}
