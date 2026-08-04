import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "logout_ip");
  if (guard) return guard;
  await (await supabaseAuth()).auth.signOut().catch(() => undefined);
  await clearSession();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
