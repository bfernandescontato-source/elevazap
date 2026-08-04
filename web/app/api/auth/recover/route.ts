import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { clientIp, persistentRateLimit, requireValidOrigin } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  if (!await persistentRateLimit(clientIp(request), "auth_recover_ip", 5, 15 * 60)) {
    return NextResponse.redirect(new URL("/recuperar-senha?error=rate", request.url), { status: 303 });
  }
  const email = z.string().email().safeParse(String((await request.formData()).get("email") || "").trim());
  if (email.success) {
    await (await supabaseAuth()).auth.resetPasswordForEmail(email.data.toLowerCase(), {
      redirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/confirm?next=/redefinir-senha`
    });
  }
  return NextResponse.redirect(new URL("/recuperar-senha?sent=1", request.url), { status: 303 });
}
