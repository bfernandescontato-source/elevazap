import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { persistentRateLimit, requireAccountContext, requireValidOrigin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const allowed = await persistentRateLimit(context.session.userId!, "comunidade_upload", 20, 3600);
  if (!allowed) return NextResponse.json({ error: "Muitos uploads. Aguarde um pouco." }, { status: 429 });
  const body = await request.json().catch(() => null);
  const mimeType = String(body?.mime_type || "");
  const sizeBytes = Number(body?.file_size_bytes || 0);
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) return NextResponse.json({ error: "Tipo de arquivo não permitido." }, { status: 400 });
  if (!sizeBytes || sizeBytes > MAX_BYTES) return NextResponse.json({ error: "Imagem acima do limite de 10MB." }, { status: 400 });
  const safeName = String(body?.file_name || "imagem").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  const storage_path = `community/${context.accountId}/${context.session.userId}/${randomUUID()}/${safeName}`;
  const { data, error } = await supabaseAdmin().storage.from("community-media").createSignedUploadUrl(storage_path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bucket: "community-media", storage_path, token: data.token, signedUrl: data.signedUrl });
}
