import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appUrl } from "@/lib/env";
import { clientIp, persistentRateLimit, requireValidOrigin } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  if (!await persistentRateLimit(clientIp(request), "auth_magic_ip", 5, 15 * 60)) {
    return NextResponse.redirect(new URL("/magic-link?error=rate", request.url), { status: 303 });
  }
  const email = z.string().email().safeParse(String((await request.formData()).get("email") || "").trim());
  if (!email.success) return NextResponse.redirect(new URL("/magic-link?error=invalid", request.url), { status: 303 });
  const { error } = await (await supabaseAuth()).auth.signInWithOtp({
    email: email.data.toLowerCase(),
    options: { shouldCreateUser: false, emailRedirectTo: `${appUrl()}/auth/confirm?next=/dashboard` }
  });
  if (error) return NextResponse.redirect(new URL("/magic-link?error=invalid", request.url), { status: 303 });
  return NextResponse.redirect(new URL("/magic-link?sent=1", request.url), { status: 303 });
}
