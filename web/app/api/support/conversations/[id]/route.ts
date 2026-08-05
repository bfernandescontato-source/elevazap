import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await params;

  const supabase = supabaseAdmin();
  const { data: conv } = await supabase
    .from("support_conversation")
    .select("*")
    .eq("id", id)
    .eq("account_id", context.accountId)
    .maybeSingle();

  if (!conv) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const { data: messages } = await supabase
    .from("support_message")
    .select("*")
    .eq("conversation_id", id)
    .eq("account_id", context.accountId)
    .order("created_at", { ascending: true });

  return NextResponse.json({ conversation: conv, messages: messages || [] });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminMutation(request);
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await params;

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
    .eq("id", id)
    .eq("account_id", context.accountId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data });
}
