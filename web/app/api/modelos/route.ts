import { NextRequest, NextResponse } from "next/server";
import { modeloMensagemSchema } from "@/lib/schemas";
import { guardAdminMutation, requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

function toRow(body: any) {
  const media = body.media || null;
  return {
    pasta_id: body.pasta_id || null,
    nome: body.nome,
    tipo: body.tipo,
    texto: body.texto || null,
    media_bucket: media?.bucket || null,
    media_path: media?.storage_path || null,
    file_name: media?.file_name || null,
    mime_type: media?.mime_type || null,
    file_size_bytes: media?.file_size_bytes || null,
    updated_at: new Date().toISOString()
  };
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const { data, error } = await supabaseAdmin().from("modelos_mensagem").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "modelos_ip");
  if (guard) return guard;
  const parsed = modeloMensagemSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("modelos_mensagem").insert(toRow(parsed.data)).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, modelo: data });
}

export async function PATCH(request: NextRequest) {
  const guard = await guardAdminMutation(request, "modelos_ip");
  if (guard) return guard;
  const parsed = modeloMensagemSchema.required({ id: true }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  const { error } = await supabaseAdmin().from("modelos_mensagem").update(toRow(parsed.data)).eq("id", parsed.data.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const guard = await guardAdminMutation(request, "modelos_ip");
  if (guard) return guard;
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  const { error } = await supabaseAdmin().from("modelos_mensagem").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
