import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { requireValidOrigin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrCreateUserProfile } from "@/lib/user-access";

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

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { name: parsed.data.name }
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
  if (!data.user) return NextResponse.redirect(new URL("/cadastro?error=provider", request.url), { status: 303 });
  const profile = await getOrCreateUserProfile(data.user);
  if (!profile) return NextResponse.redirect(new URL("/cadastro?error=provider", request.url), { status: 303 });
  const { data: activeProfile, error: activateError } = await admin.from("app_users").update({
    status: "active",
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq("id", profile.id).select("id,email,name,role,status").single();
  if (activateError || !activeProfile) return NextResponse.redirect(new URL("/cadastro?error=provider", request.url), { status: 303 });
  await createSession({ userId: activeProfile.id, email: activeProfile.email, name: activeProfile.name, role: activeProfile.role, source: "supabase" });
  return NextResponse.redirect(new URL("/dashboard", request.url), { status: 303 });
}
