import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "signed_upload_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { storage_path } = await request.json();
  if (!String(storage_path).startsWith(`accounts/${context.accountId}/uploads/`)) return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });
  const { data, error } = await supabaseAdmin().storage.from("whatsapp-media").list(storage_path.split("/").slice(0, -1).join("/"));
  if (error || !data?.length) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
