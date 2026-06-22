import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { mediaKindSchema, validateMedia } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "signed_upload_ip");
  if (guard) return guard;
  const body = await request.json();
  const kind = mediaKindSchema.parse(body.tipo);
  const valid = validateMedia(kind, body.mime_type, Number(body.file_size_bytes));
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
  const safeName = String(body.file_name || "arquivo").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  const storage_path = `uploads/${randomUUID()}/${safeName}`;
  const { data, error } = await supabaseAdmin().storage.from("whatsapp-media").createSignedUploadUrl(storage_path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bucket: "whatsapp-media", storage_path, token: data.token, signedUrl: data.signedUrl });
}
