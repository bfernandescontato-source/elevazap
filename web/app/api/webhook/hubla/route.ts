import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { env } from "@/lib/env";

const INITIAL_PASSWORD = "123456";

export async function POST(request: NextRequest) {
  const token = env().HUBLA_WEBHOOK_TOKEN;
  const received = request.headers.get("x-hubla-token");
  if (!token || received !== token) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (body?.type !== "subscription.activated") return NextResponse.json({ ok: true, ignored: true });
  const user = body?.event?.user;
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return NextResponse.json({ error: "E-mail ausente no evento." }, { status: 400 });
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || email;
  const admin = supabaseAdmin();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: INITIAL_PASSWORD,
    email_confirm: true,
    user_metadata: { name, source: "hubla" }
  });
  if (createError && !/already registered|already been registered|user already exists|email.*exists/i.test(createError.message)) {
    return NextResponse.json({ error: "Não foi possível criar o usuário." }, { status: 500 });
  }
  let userId = created.user?.id;
  if (!userId) {
    const { data: users, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return NextResponse.json({ error: "Não foi possível localizar o usuário existente." }, { status: 500 });
    userId = users.users.find((item) => item.email?.toLowerCase() === email)?.id;
  }
  if (!userId) return NextResponse.json({ error: "Usuário não localizado." }, { status: 500 });
  const { error: passwordError } = await admin.auth.admin.updateUserById(userId, {
    password: INITIAL_PASSWORD,
    email_confirm: true,
    user_metadata: { name, source: "hubla" }
  });
  if (passwordError) return NextResponse.json({ error: "Usuário localizado, mas senha não foi configurada." }, { status: 500 });
  const { error: profileError } = await admin.from("app_users").upsert({
    id: userId, email, name, role: "operator", status: "active", approved_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }, { onConflict: "id" });
  if (profileError) return NextResponse.json({ error: "Usuário criado, mas perfil não foi configurado." }, { status: 500 });
  return NextResponse.json({ ok: true, created: Boolean(created.user), email });
}
