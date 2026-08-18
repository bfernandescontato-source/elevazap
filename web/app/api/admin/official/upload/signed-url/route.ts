import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { supabaseAdmin } from "@/lib/supabase";
import { mediaKindSchema, validateMedia } from "@/lib/schemas";

const RESPONSE_TYPE_TO_KIND: Record<string, string> = { image: "imagem", video: "video", audio: "audio", document: "documento" };

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_upload_ip");
  if (guard) return guard;
  const body = await request.json().catch(() => null) as Record<string, any> | null;
  const kind = mediaKindSchema.parse(RESPONSE_TYPE_TO_KIND[body?.responseType] || body?.responseType);
  const valid = validateMedia(kind, body?.mime_type, Number(body?.file_size_bytes));
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
  const safeName = String(body?.file_name || "arquivo").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  const storage_path = `official/quick-reply/${randomUUID()}/${safeName}`;
  const { data, error } = await supabaseAdmin().storage.from("whatsapp-media").createSignedUploadUrl(storage_path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bucket: "whatsapp-media", storage_path, token: data.token, signedUrl: data.signedUrl });
}
