import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { createRoute, listRoutes, RouteError, routeInputSchema } from "@/modules/offer-autopilot/server/routes-service";
import { serverError } from "@/shared/http/responses";

export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  try { return NextResponse.json(await listRoutes(context.accountId)); }
  catch (error) { return serverError(error, "Não foi possível carregar as rotas do Piloto."); }
}

export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request); if (origin) return origin;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = routeInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Rota inválida." }, { status: 400 });
  try { return NextResponse.json({ route: await createRoute(context.accountId, parsed.data) }, { status: 201 }); }
  catch (error) { if (error instanceof RouteError) return NextResponse.json({ error: error.message }, { status: error.status }); return serverError(error, "Não foi possível criar a rota."); }
}
