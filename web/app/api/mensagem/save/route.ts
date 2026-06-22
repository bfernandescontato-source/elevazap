import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const { welcome_message } = await request.json();
  if (!welcome_message || String(welcome_message).length > 4000) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
  const sb = supabaseAdmin();
  const existing = await sb.from("config").select("id").limit(1).maybeSingle();
  const result = existing.data?.id
    ? await sb.from("config").update({ welcome_message, updated_at: new Date().toISOString() }).eq("id", existing.data.id)
    : await sb.from("config").insert({ welcome_message });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
