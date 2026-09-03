import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { offerActionSchema } from "@/modules/offer-autopilot/schemas";
import { loadOffer } from "@/modules/offer-autopilot/server/service";
import { serverError } from "@/shared/http/responses";
import { env } from "@/lib/env";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await params;
  try {
    const offer = await loadOffer(context.database, context.accountId, id);
    return offer ? NextResponse.json(offer) : NextResponse.json({ error: "Oferta não encontrada." }, { status: 404 });
  } catch (error) { return serverError(error, "Não foi possível carregar a oferta."); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = offerActionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const { id } = await params;
  const { data: offer } = await context.database.from("captured_offers").select("id,status").eq("id", id).eq("account_id", context.accountId).maybeSingle();
  if (!offer) return NextResponse.json({ error: "Oferta não encontrada." }, { status: 404 });
  try {
    if (parsed.data.action === "ignore") {
      if (["sent", "sending"].includes(offer.status)) return NextResponse.json({ error: "Esta oferta já está em envio ou foi enviada." }, { status: 409 });
      const { data: deliveries } = await context.database.from("offer_deliveries").select("group_dispatch_id").eq("offer_id", id).eq("account_id", context.accountId);
      const dispatchIds = (deliveries || []).map((row) => row.group_dispatch_id).filter(Boolean);
      if (dispatchIds.length) await context.database.from("envios_grupo").update({ status: "cancelado", updated_at: new Date().toISOString() }).eq("account_id", context.accountId).in("id", dispatchIds).in("status", ["pendente", "enfileirado"]);
      await context.database.from("offer_deliveries").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("offer_id", id).eq("account_id", context.accountId).in("status", ["pending", "scheduled"]);
      await context.database.from("captured_offers").update({ status: "ignored", updated_at: new Date().toISOString() }).eq("id", id).eq("account_id", context.accountId);
    } else if (parsed.data.action === "dispatch_now") {
      if (!['ready','scheduled','send_failed'].includes(offer.status)) return NextResponse.json({ error: "Esta oferta não pode ser disparada agora." }, { status: 409 });
      const now = new Date().toISOString();
      const { data: deliveries } = await context.database.from("offer_deliveries").select("group_dispatch_id").eq("offer_id", id).eq("account_id", context.accountId);
      const dispatchIds = (deliveries || []).map((row) => row.group_dispatch_id).filter(Boolean);
      if (!dispatchIds.length) return NextResponse.json({ error: "A oferta não possui destinos preparados." }, { status: 409 });
      await context.database.from("envios_grupo").update({ status: "pendente", scheduled_at: now, next_attempt_at: null, updated_at: now }).eq("account_id", context.accountId).in("id", dispatchIds).in("status", ["pendente", "erro"]);
      await context.database.from("offer_deliveries").update({ status: "scheduled", scheduled_at: now, error_message: null, updated_at: now }).eq("offer_id", id).eq("account_id", context.accountId).in("status", ["scheduled", "failed"]);
      await context.database.from("captured_offers").update({ status: "scheduled", scheduled_at: now, updated_at: now }).eq("id", id).eq("account_id", context.accountId);
    } else if (parsed.data.action === "retry_conversion" || parsed.data.action === "retry_queue") {
      const response = await fetch(`${env().WHATSAPP_SERVICE_URL}/offers/${encodeURIComponent(id)}/retry-conversion`, {
        method: "POST", headers: { "content-type": "application/json", "x-internal-api-key": env().INTERNAL_API_KEY },
        body: JSON.stringify({ accountId: context.accountId }), signal: AbortSignal.timeout(180_000)
      });
      const body = await response.json();
      if (!response.ok) return NextResponse.json({ error: body.error || "Não foi possível tentar novamente." }, { status: 400 });
    } else {
      await context.database.from("captured_offers").update({ processed_text: parsed.data.text, updated_at: new Date().toISOString() }).eq("id", id).eq("account_id", context.accountId);
      const { data: deliveries } = await context.database.from("offer_deliveries").select("group_dispatch_id").eq("offer_id", id).eq("account_id", context.accountId);
      const dispatchIds = (deliveries || []).map((row) => row.group_dispatch_id).filter(Boolean);
      if (dispatchIds.length) await context.database.from("envios_grupo").update({ texto: parsed.data.text, legenda: parsed.data.text, updated_at: new Date().toISOString() }).eq("account_id", context.accountId).in("id", dispatchIds).in("status", ["pendente", "erro"]);
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return serverError(error, "Não foi possível atualizar a oferta."); }
}
