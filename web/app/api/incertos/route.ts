import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const sb = supabaseAdmin();
  const [envios, grupos] = await Promise.all([
    sb.from("envios").select("*").eq("account_id", context.accountId).eq("status", "incerto").order("created_at", { ascending: false }),
    sb.from("envios_grupo").select("*").eq("account_id", context.accountId).eq("status", "incerto").order("created_at", { ascending: false })
  ]);
  return NextResponse.json({ envios: envios.data || [], grupos: grupos.data || [] });
}
