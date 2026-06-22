import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const sb = supabaseAdmin();
  const [envios, grupos, lotes] = await Promise.all([
    sb.from("envios").select("*").order("created_at", { ascending: false }).limit(5),
    sb.from("grupos").select("id", { count: "exact", head: true }),
    sb.from("envios_grupo_lotes").select("*").order("created_at", { ascending: false }).limit(5)
  ]);
  const statuses = await Promise.all(["pendente", "enfileirado", "processando", "incerto", "erro"].map((status) => sb.from("envios").select("id", { count: "exact", head: true }).eq("status", status)));
  let service = { status: "disconnected", queue: { size: 0, highPriority: 0, normalPriority: 0 }, lock: "unknown", ffmpeg: "unknown" };
  try { service = await callWhatsappService("/status"); } catch {}
  return NextResponse.json({
    service,
    latestEnvios: envios.data || [],
    latestLotes: lotes.data || [],
    counts: {
      pending: statuses[0].count || 0,
      queued: statuses[1].count || 0,
      processing: statuses[2].count || 0,
      uncertain: statuses[3].count || 0,
      welcome_uncertain: statuses[3].count || 0,
      errors: statuses[4].count || 0,
      groups: grupos.count || 0,
      sent_today: 0
    }
  });
}
