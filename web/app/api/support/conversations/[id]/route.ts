import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (guard) return guard;

  const supabase = supabaseAdmin();
  const { data: conv } = await supabase
    .from("support_conversation")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (!conv) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const { data: messages } = await supabase
    .from("support_message")
    .select("*")
    .eq("conversation_id", params.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ conversation: conv, messages: messages || [] });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminMutation(request);
  if (guard) return guard;

  const body = await request.json();
  const supabase = supabaseAdmin();

  const allowed = ["status", "ai_paused_until"];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  const { data, error } = await supabase
    .from("support_conversation")
    .update(update)
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data });
}
