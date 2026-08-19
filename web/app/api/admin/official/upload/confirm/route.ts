import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_upload_ip");
  if (guard) return guard;
  const { storage_path } = await request.json().catch(() => ({ storage_path: "" }));
  if (!String(storage_path).startsWith("official/quick-reply/")) return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });
  const { data, error } = await supabaseAdmin().storage.from("whatsapp-media").list(String(storage_path).split("/").slice(0, -1).join("/"));
  if (error || !data?.length) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
