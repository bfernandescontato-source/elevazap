import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { getSession } from "@/lib/auth";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const session = await getSession();
  return NextResponse.json({
    account: {
      name: session?.name || null,
      email: session?.email || "",
      role: session?.role === "admin" ? "Administrador" : "Operador"
    },
    capabilities: {
      profileEditing: false,
      userManagement: session?.role === "admin",
      passwordChange: session?.source === "supabase",
      billing: false
    }
  });
}
