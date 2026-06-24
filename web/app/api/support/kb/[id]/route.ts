import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminMutation(request);
  if (guard) return guard;

  const { title, content } = await request.json();
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("support_kb")
    .update({ title, content, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminMutation(request);
  if (guard) return guard;

  const supabase = supabaseAdmin();
  await supabase.from("support_kb").delete().eq("id", params.id);
  return NextResponse.json({ ok: true });
}
