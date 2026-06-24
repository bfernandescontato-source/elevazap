import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";
import { randomUUID } from "crypto";

async function getOrCreateAgent(supabase: ReturnType<typeof supabaseAdmin>) {
  const { data } = await supabase.from("support_agent").select("*").limit(1).maybeSingle();
  if (data) return data;

  const sessionId = `support_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const { data: created } = await supabase
    .from("support_agent")
    .insert({ whatsapp_session_id: sessionId, name: "Agente de Suporte", enabled: false })
    .select("*")
    .single();
  return created;
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const supabase = supabaseAdmin();
  const agent = await getOrCreateAgent(supabase);
  const { data: kb } = await supabase.from("support_kb").select("*").eq("agent_id", agent.id).order("created_at");
  return NextResponse.json({ agent, kb: kb || [] });
}

export async function PUT(request: NextRequest) {
  const guard = await guardAdminMutation(request);
  if (guard) return guard;

  const supabase = supabaseAdmin();
  const agent = await getOrCreateAgent(supabase);
  const body = await request.json();

  const allowed = ["name", "enabled", "system_prompt", "model", "temperature", "max_history",
    "aggregation_seconds", "human_takeover_minutes", "business_hours", "fallback_message"];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  const { data, error } = await supabase
    .from("support_agent")
    .update(update)
    .eq("id", agent.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify whatsapp-service to reload the agent session
  await callWhatsappService(`/support/${agent.id}/reload`, { method: "POST" }).catch(() => undefined);

  return NextResponse.json({ agent: data });
}
