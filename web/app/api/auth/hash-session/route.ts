import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { clientIp, persistentRateLimit, requireValidOrigin } from "@/lib/security";
import { supabaseAuth } from "@/lib/supabase-auth";
import { getOrCreateUserProfile } from "@/lib/user-access";

const schema = z.object({
  access_token: z.string().min(20).max(5000),
  refresh_token: z.string().min(5).max(5000),
  type: z.string().max(40).optional()
});

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  if (!await persistentRateLimit(clientIp(request), "auth_hash_session_ip", 10, 15 * 60)) {
    return NextResponse.json({ error: "Muitas tentativas. Solicite um novo link." }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Link de autenticação inválido." }, { status: 400 });

  const auth = await supabaseAuth();
  const { data, error } = await auth.auth.setSession({
    access_token: parsed.data.access_token,
    refresh_token: parsed.data.refresh_token
  });
  if (error || !data.user) return NextResponse.json({ error: "Este link expirou ou já foi utilizado." }, { status: 401 });

  const profile = await getOrCreateUserProfile(data.user);
  if (!profile) return NextResponse.json({ error: "A estrutura de perfis ainda não foi ativada no banco." }, { status: 503 });
  if (profile.status === "active") {
    await createSession({ userId: profile.id, email: profile.email, name: profile.name, role: profile.role, source: "supabase" });
  }
  if (parsed.data.type === "recovery") return NextResponse.json({ redirectTo: "/redefinir-senha" });
  if (profile.status !== "active") {
    await auth.auth.signOut();
    return NextResponse.json({ redirectTo: `/auth/pending?status=${profile.status}` });
  }
  return NextResponse.json({ redirectTo: "/dashboard" });
}
