import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const sb = supabaseAdmin();
  const [envios, grupos] = await Promise.all([
    sb.from("envios").select("*").eq("status", "incerto").order("created_at", { ascending: false }),
    sb.from("envios_grupo").select("*").eq("status", "incerto").order("created_at", { ascending: false })
  ]);
  return NextResponse.json({ envios: envios.data || [], grupos: grupos.data || [] });
}
