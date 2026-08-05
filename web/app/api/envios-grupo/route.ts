import { NextResponse } from "next/server";
import { requireTenantDatabase } from "@/lib/tenant-database";

export async function GET() {
  const context = await requireTenantDatabase();
  if (context.error) return context.error;
  const { data, error } = await context.database.from("envios_grupo").select("*").eq("account_id", context.accountId).order("created_at", { ascending: false }).limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
