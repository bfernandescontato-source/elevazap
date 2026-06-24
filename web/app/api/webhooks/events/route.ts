import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard) return guard;
  const status = request.nextUrl.searchParams.get("status");
  let query = supabaseAdmin()
    .from("webhook_events")
    .select("*, webhook_rules(name), envios(status,erro,attempts,sent_at,wa_message_id)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data || []).map((event: any) => {
    const envio = event.envios;
    if (!envio) return event;
    const mappedStatus = envio.status === "sucesso" ? "success" : envio.status === "erro" ? "failed" : envio.status === "incerto" ? "uncertain" : event.status;
    return {
      ...event,
      status: event.status === "queued" ? mappedStatus : event.status,
      attempts: envio.attempts ?? event.attempts,
      sent_at: envio.sent_at || event.sent_at,
      error_message: envio.erro || event.error_message
    };
  });
  return NextResponse.json(rows);
}
