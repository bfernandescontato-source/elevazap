import { NextRequest, NextResponse } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { z } from "zod";
import { appUrl } from "@/lib/env";
import { requireValidOrigin } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  const email = z.string().email().safeParse(String((await request.formData()).get("email") || "").trim());
  if (!email.success) return NextResponse.redirect(publicUrl("/magic-link?error=invalid", request), { status: 303 });
  const { error } = await (await supabaseAuth()).auth.signInWithOtp({
    email: email.data.toLowerCase(),
    options: { shouldCreateUser: false, emailRedirectTo: `${appUrl()}/auth/confirm?next=/dashboard` }
  });
  if (error) return NextResponse.redirect(publicUrl("/magic-link?error=invalid", request), { status: 303 });
  return NextResponse.redirect(publicUrl("/magic-link?sent=1", request), { status: 303 });
}
