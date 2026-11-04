import { NextRequest, NextResponse } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { createSession, verifyPassword } from "@/lib/auth";
import { clientIp, persistentRateLimit, requireValidOrigin } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";
import { getOrCreateUserProfile } from "@/lib/user-access";
import { accountSessionFor } from "@/lib/account-session";

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  const allowed = await persistentRateLimit(clientIp(request), "login_ip", 8, 15 * 60);
  if (!allowed) return NextResponse.redirect(publicUrl("/login?error=1", request), { status: 303 });
  const form = await request.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const auth = await supabaseAuth();
  const { data, error } = await auth.auth.signInWithPassword({ email, password });

  if (!error && data.user) {
    const profile = await getOrCreateUserProfile(data.user);
    if (!profile) return NextResponse.redirect(publicUrl("/login?error=setup", request), { status: 303 });
    const access = accountSessionFor(profile);
    if (!access.ok) {
      await auth.auth.signOut();
      return NextResponse.redirect(publicUrl(`/login?error=${access.reason}`, request), { status: 303 });
    }
    await createSession(access.session);
    return NextResponse.redirect(publicUrl("/dashboard", request), { status: 303 });
  }

  const legacyOk = await verifyPassword(email, password).catch(() => false);
  if (!legacyOk) return NextResponse.redirect(publicUrl("/login?error=invalid", request), { status: 303 });
  return NextResponse.redirect(publicUrl("/login?error=legacy-disabled", request), { status: 303 });
}
