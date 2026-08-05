import { NextResponse } from "next/server";
import { requireTenantDatabase } from "@/lib/tenant-database";
import { listDispatchBatches } from "@/modules/dispatches/server/dispatch-query-service";
import { serverError } from "@/shared/http/responses";

export async function GET() {
  const context = await requireTenantDatabase();
  if (context.error) return context.error;
  try { return NextResponse.json(await listDispatchBatches(context.database, context.accountId)); }
  catch (error) { return serverError(error, "Não foi possível carregar os lotes."); }
}
