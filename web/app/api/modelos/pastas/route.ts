import { NextRequest, NextResponse } from "next/server";
import { modeloPastaSchema } from "@/lib/schemas";
import { guardAdminMutation, requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const { data, error } = await supabaseAdmin().from("modelo_pastas").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "modelos_ip");
  if (guard) return guard;
  const parsed = modeloPastaSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Pasta inválida." }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("modelo_pastas").insert({ nome: parsed.data.nome }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, pasta: data });
}

export async function PATCH(request: NextRequest) {
  const guard = await guardAdminMutation(request, "modelos_ip");
  if (guard) return guard;
  const parsed = modeloPastaSchema.required({ id: true }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Pasta inválida." }, { status: 400 });
  const { error } = await supabaseAdmin().from("modelo_pastas").update({ nome: parsed.data.nome, updated_at: new Date().toISOString() }).eq("id", parsed.data.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const guard = await guardAdminMutation(request, "modelos_ip");
  if (guard) return guard;
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "Pasta inválida." }, { status: 400 });
  const { error } = await supabaseAdmin().from("modelo_pastas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
