import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appUrl } from "@/lib/env";
import { requireValidOrigin } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128)
});

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  const form = await request.formData();
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return NextResponse.redirect(new URL("/cadastro?error=invalid", request.url), { status: 303 });

  const auth = await supabaseAuth();
  const { data, error } = await auth.auth.signUp({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
    options: { data: { name: parsed.data.name }, emailRedirectTo: `${appUrl()}/auth/confirm?next=/auth/pending` }
  });
  if (error) {
    const message = error.message.toLowerCase();
    const code = /already registered|already been registered|user already exists|email.*exists/.test(message)
      ? "exists"
      : /signups? not allowed|disable.*signup/.test(message)
        ? "disabled"
        : /rate limit|too many requests/.test(message)
          ? "rate"
          : "provider";
    return NextResponse.redirect(new URL(`/cadastro?error=${code}`, request.url), { status: 303 });
  }
  const destination = data.session ? "/auth/pending" : "/cadastro?sent=1";
  return NextResponse.redirect(new URL(destination, request.url), { status: 303 });
}
