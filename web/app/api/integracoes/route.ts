import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { listIntegrations } from "@/modules/integrations/server/service";
import { serverError } from "@/shared/http/responses";

export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  try { return NextResponse.json(await listIntegrations(context.database, context.accountId)); }
  catch (error) { return serverError(error, "Não foi possível carregar as integrações."); }
}
