import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { getSession } from "@/lib/auth";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const session = await getSession();
  return NextResponse.json({
    account: {
      name: session?.name || null,
      email: session?.email || "",
      role: session?.role === "admin" ? "Administrador" : "Operador",
      plan: context.account?.plan || "default",
      status: context.account?.status || "active",
      accountName: context.account?.name || null
    },
    capabilities: {
      profileEditing: false,
      userManagement: session?.role === "admin",
      passwordChange: session?.source === "supabase",
      billing: false
    }
  });
}
