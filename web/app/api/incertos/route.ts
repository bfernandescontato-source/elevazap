import { NextResponse } from "next/server";
import { requireTenantDatabase } from "@/lib/tenant-database";

export async function GET() {
  const context = await requireTenantDatabase();
  if (context.error) return context.error;
  const sb = context.database;
  const [envios, grupos] = await Promise.all([
    sb.from("envios").select("*").eq("account_id", context.accountId).eq("status", "incerto").order("created_at", { ascending: false }),
    sb.from("envios_grupo").select("*").eq("account_id", context.accountId).eq("status", "incerto").order("created_at", { ascending: false })
  ]);
  return NextResponse.json({ envios: envios.data || [], grupos: grupos.data || [] });
}
