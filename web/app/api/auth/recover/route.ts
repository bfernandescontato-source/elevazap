import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appUrl } from "@/lib/env";
import { requireValidOrigin } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  const email = z.string().email().safeParse(String((await request.formData()).get("email") || "").trim());
  if (email.success) {
    await (await supabaseAuth()).auth.resetPasswordForEmail(email.data.toLowerCase(), {
      redirectTo: `${appUrl()}/auth/confirm?next=/redefinir-senha`
    });
  }
  return NextResponse.redirect(new URL("/recuperar-senha?sent=1", request.url), { status: 303 });
}
