import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { storage_path } = await request.json().catch(() => ({ storage_path: "" }));
  if (!String(storage_path || "").startsWith(`community/${context.accountId}/${context.session.userId}/`)) {
    return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin().storage.from("community-media").list(storage_path.split("/").slice(0, -1).join("/"));
  if (error || !data?.length) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
