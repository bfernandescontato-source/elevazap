import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { duplicateRoute, RouteError } from "@/modules/offer-autopilot/server/routes-service";
import { serverError } from "@/shared/http/responses";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = requireValidOrigin(request); if (origin) return origin;
  const context = await requireAccountContext(); if (context.error) return context.error;
  try { return NextResponse.json({ route: await duplicateRoute(context.accountId, (await params).id) }, { status: 201 }); }
  catch (error) { if (error instanceof RouteError) return NextResponse.json({ error: error.message }, { status: error.status }); return serverError(error, "Não foi possível duplicar a rota."); }
}
