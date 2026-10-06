import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { disconnectIntegration, saveMagaluStore } from "@/modules/integrations/server/service";
import { serverError } from "@/shared/http/responses";

export async function PUT(request: NextRequest) {
  const origin = requireValidOrigin(request); if (origin) return origin;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const body = await request.json().catch(() => null);
  const store = typeof body?.store === "string" ? body.store : "";
  try { return NextResponse.json(await saveMagaluStore(context.database, context.accountId, context.session.userId!, store)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar sua loja Magazine Você." }, { status: 400 }); }
}

export async function DELETE(request: NextRequest) {
  const origin = requireValidOrigin(request); if (origin) return origin;
  const context = await requireAccountContext(); if (context.error) return context.error;
  try { return NextResponse.json(await disconnectIntegration(context.database, context.accountId, "magalu")); }
  catch (error) { return serverError(error, "Não foi possível desconectar a Magalu."); }
}
