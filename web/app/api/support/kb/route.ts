import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

async function getAgentId(supabase: ReturnType<typeof supabaseAdmin>) {
  const { data } = await supabase.from("support_agent").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const supabase = supabaseAdmin();
  const agentId = await getAgentId(supabase);
  if (!agentId) return NextResponse.json({ kb: [] });

  const { data } = await supabase.from("support_kb").select("*").eq("agent_id", agentId).order("created_at");
  return NextResponse.json({ kb: data || [] });
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request);
  if (guard) return guard;

  const supabase = supabaseAdmin();
  const agentId = await getAgentId(supabase);
  if (!agentId) return NextResponse.json({ error: "Agente não encontrado." }, { status: 404 });

  const { title, content } = await request.json();
  if (!title?.trim() || !content?.trim()) return NextResponse.json({ error: "Título e conteúdo obrigatórios." }, { status: 400 });

  const { data, error } = await supabase
    .from("support_kb")
    .insert({ agent_id: agentId, title, content })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data }, { status: 201 });
}
