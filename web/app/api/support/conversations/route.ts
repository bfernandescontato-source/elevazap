import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const supabase = supabaseAdmin();
  const { data: agent } = await supabase.from("support_agent").select("id").limit(1).maybeSingle();
  if (!agent) return NextResponse.json({ conversations: [] });

  const { data, error } = await supabase
    .from("support_conversation")
    .select("*")
    .eq("agent_id", agent.id)
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data || [] });
}
