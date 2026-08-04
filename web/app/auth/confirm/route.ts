import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { supabaseAuth } from "@/lib/supabase-auth";
import { getOrCreateUserProfile } from "@/lib/user-access";

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
  if (!user) return NextResponse.redirect(new URL("/login?error=link", request.url));

  const profile = await getOrCreateUserProfile(user);
  if (!profile) return NextResponse.redirect(new URL("/login?error=setup", request.url));
  if (next === "/redefinir-senha") {
    if (profile.status === "active") await createSession({ userId: profile.id, email: profile.email, name: profile.name, role: profile.role, source: "supabase" });
    return NextResponse.redirect(new URL(next, request.url));
  }
  if (profile.status !== "active") {
    await auth.auth.signOut();
    return NextResponse.redirect(new URL(`/auth/pending?status=${profile.status}`, request.url));
  }
  await createSession({ userId: profile.id, email: profile.email, name: profile.name, role: profile.role, source: "supabase" });
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/dashboard", request.url));
}
