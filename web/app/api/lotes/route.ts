import { NextResponse } from "next/server";
import { requireTenantDatabase } from "@/lib/tenant-database";
import { listDispatchBatches } from "@/modules/dispatches/server/dispatch-query-service";
import { serverError } from "@/shared/http/responses";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const context = await requireTenantDatabase();
  if (context.error) return context.error;
  try {
    const { data: control } = await supabaseAdmin().from("queue_control").select("queue_reset_at")
      .eq("key", "whatsapp_dispatch").maybeSingle();
    return NextResponse.json(await listDispatchBatches(context.database, context.accountId, control?.queue_reset_at));
  }
  catch (error) { return serverError(error, "Não foi possível carregar os lotes."); }
}
