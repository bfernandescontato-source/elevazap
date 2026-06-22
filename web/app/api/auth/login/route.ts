import { NextRequest, NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth";
import { clientIp, persistentRateLimit } from "@/lib/security";

export async function POST(request: NextRequest) {
  const allowed = await persistentRateLimit(clientIp(request), "login_ip", 8, 15 * 60);
  if (!allowed) return NextResponse.redirect(new URL("/login?error=1", request.url), { status: 303 });
  const form = await request.formData();
  const ok = await verifyPassword(String(form.get("email") || ""), String(form.get("password") || ""));
  if (!ok) return NextResponse.redirect(new URL("/login?error=1", request.url), { status: 303 });
  await createSession();
  return NextResponse.redirect(new URL("/dashboard", request.url), { status: 303 });
}
