import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { clientIp, persistentRateLimit, requireValidOrigin } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128)
});

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  if (!await persistentRateLimit(clientIp(request), "auth_signup_ip", 5, 60 * 60)) {
    return NextResponse.redirect(new URL("/cadastro?error=rate", request.url), { status: 303 });
  }
  const form = await request.formData();
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return NextResponse.redirect(new URL("/cadastro?error=invalid", request.url), { status: 303 });

  const auth = await supabaseAuth();
  const { data, error } = await auth.auth.signUp({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
    options: { data: { name: parsed.data.name }, emailRedirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/confirm?next=/auth/pending` }
  });
  if (error) return NextResponse.redirect(new URL("/cadastro?error=exists", request.url), { status: 303 });
  const destination = data.session ? "/auth/pending" : "/cadastro?sent=1";
  return NextResponse.redirect(new URL(destination, request.url), { status: 303 });
}
