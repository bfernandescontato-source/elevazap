import { NextRequest, NextResponse } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { createSession } from "@/lib/auth";
import { supabaseAuth } from "@/lib/supabase-auth";
import { getOrCreateUserProfile } from "@/lib/user-access";
import { accountSessionFor } from "@/lib/account-session";

export async function GET(request: NextRequest) {
  const auth = await supabaseAuth();
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const requestedNext = request.nextUrl.searchParams.get("next");
  const next = type === "recovery" ? "/redefinir-senha" : requestedNext || "/dashboard";
  let user = null;

  if (code) {
    const { data } = await auth.auth.exchangeCodeForSession(code);
    user = data.user;
  } else if (tokenHash && type) {
    const { data } = await auth.auth.verifyOtp({ token_hash: tokenHash, type: type as any });
    user = data.user;
  }
  if (!user) return NextResponse.redirect(publicUrl("/login?error=link", request));

  const profile = await getOrCreateUserProfile(user);
  if (!profile) return NextResponse.redirect(publicUrl("/login?error=setup", request));
  const access = accountSessionFor(profile);
  if (next === "/redefinir-senha") {
    if (access.ok) await createSession(access.session);
    else if (profile.status === "active") await createSession({ userId: profile.id, email: profile.email, name: profile.name, role: profile.role, source: "supabase" });
    return NextResponse.redirect(publicUrl(next, request));
  }
  if (profile.status !== "active") {
    await auth.auth.signOut();
    return NextResponse.redirect(publicUrl(`/auth/pending?status=${profile.status}`, request));
  }
  // 04/11: o link do e-mail agora grava a conta na sessão, igual ao login por senha
  if (!access.ok) {
    await auth.auth.signOut();
    return NextResponse.redirect(publicUrl(`/login?error=${access.reason}`, request));
  }
  await createSession(access.session);
  return NextResponse.redirect(publicUrl(next.startsWith("/") ? next : "/dashboard", request));
}
