import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;

  const supabase = supabaseAdmin();
  const { data: agent } = await supabase.from("support_agent").select("id").eq("account_id", context.accountId).limit(1).maybeSingle();
  if (!agent) return NextResponse.json({ conversations: [] });

  const { data, error } = await supabase
    .from("support_conversation")
    .select("*")
    .eq("agent_id", agent.id)
    .eq("account_id", context.accountId)
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data || [] });
}
