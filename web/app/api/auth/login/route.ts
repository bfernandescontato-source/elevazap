import { NextRequest, NextResponse } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { createSession, verifyPassword } from "@/lib/auth";
import { clientIp, persistentRateLimit, requireValidOrigin } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";
import { getOrCreateUserProfile } from "@/lib/user-access";

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
    if (profile.status !== "active") {
      await auth.auth.signOut();
      return NextResponse.redirect(publicUrl(`/login?error=${profile.status}`, request), { status: 303 });
    }
    const account = Array.isArray(profile.accounts) ? profile.accounts[0] : profile.accounts;
    if (!account || account.status !== "active") {
      await auth.auth.signOut();
      return NextResponse.redirect(publicUrl(`/login?error=${account?.status || "account"}`, request), { status: 303 });
    }
    await createSession({ userId: profile.id, accountId: profile.account_id, accountStatus: account.status, email: profile.email, name: profile.name, role: profile.role, source: "supabase" });
    return NextResponse.redirect(publicUrl("/dashboard", request), { status: 303 });
  }

  const legacyOk = await verifyPassword(email, password).catch(() => false);
  if (!legacyOk) return NextResponse.redirect(publicUrl("/login?error=invalid", request), { status: 303 });
  return NextResponse.redirect(publicUrl("/login?error=legacy-disabled", request), { status: 303 });
}
