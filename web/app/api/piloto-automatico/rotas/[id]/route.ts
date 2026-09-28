import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { deleteRoute, RouteError, routeInputSchema, updateRoute } from "@/modules/offer-autopilot/server/routes-service";
import { serverError } from "@/shared/http/responses";

type Params = { params: Promise<{ id: string }> };
const failure = (error: unknown, fallback: string) => error instanceof RouteError ? NextResponse.json({ error: error.message }, { status: error.status }) : serverError(error, fallback);

export async function PATCH(request: NextRequest, { params }: Params) {
  const origin = requireValidOrigin(request); if (origin) return origin;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = routeInputSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Rota inválida." }, { status: 400 });
  try { return NextResponse.json({ route: await updateRoute(context.accountId, (await params).id, parsed.data) }); }
  catch (error) { return failure(error, "Não foi possível salvar a rota."); }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const origin = requireValidOrigin(request); if (origin) return origin;
  const context = await requireAccountContext(); if (context.error) return context.error;
  try { await deleteRoute(context.accountId, (await params).id); return NextResponse.json({ ok: true }); }
  catch (error) { return failure(error, "Não foi possível excluir a rota."); }
}
