import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/security";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  return NextResponse.json({
    account: {
      name: null,
      email: env().ADMIN_EMAIL,
      role: "Administrador"
    },
    capabilities: {
      profileEditing: false,
      userManagement: false,
      passwordChange: false,
      billing: false
    }
  });
}
