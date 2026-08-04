import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireValidOrigin } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  const form = await request.formData();
  const parsed = z.object({ password: z.string().min(8).max(128), confirmation: z.string() }).safeParse(Object.fromEntries(form));
  if (!parsed.success || parsed.data.password !== parsed.data.confirmation) {
    return NextResponse.redirect(new URL("/redefinir-senha?error=invalid", request.url), { status: 303 });
  }
  const auth = await supabaseAuth();
  const { data: userData } = await auth.auth.getUser();
  if (!userData.user) return NextResponse.redirect(new URL("/recuperar-senha?error=expired", request.url), { status: 303 });
  const { error } = await auth.auth.updateUser({ password: parsed.data.password });
  if (error) return NextResponse.redirect(new URL("/redefinir-senha?error=invalid", request.url), { status: 303 });
  return NextResponse.redirect(new URL("/login?password=updated", request.url), { status: 303 });
}
