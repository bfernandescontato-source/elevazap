import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;

  const body = await request.json().catch(() => ({}));
  const subject = typeof body.subject === "string" ? body.subject.trim() : undefined;
  const description = typeof body.description === "string" ? body.description.trim() : undefined;
  const photo = body.photo && typeof body.photo === "object" ? body.photo : null;
  if (subject !== undefined && (!subject || subject.length > 100)) return NextResponse.json({ error: "O nome deve ter entre 1 e 100 caracteres." }, { status: 400 });
  if (description !== undefined && description.length > 512) return NextResponse.json({ error: "A descrição pode ter no máximo 512 caracteres." }, { status: 400 });
  if (!subject && description === undefined && !photo) return NextResponse.json({ error: "Escolha ao menos uma informação para atualizar." }, { status: 400 });

  const { id } = await params;
  const sb = supabaseAdmin();
  const { data: campaign, error } = await sb
    .from("campanhas")
    .select("id,whatsapp_sender_id,whatsapp_senders(session_name),campanha_grupos(group_jid)")
    .eq("id", id)
    .eq("account_id", context.accountId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
  const sender = Array.isArray(campaign.whatsapp_senders) ? campaign.whatsapp_senders[0] : campaign.whatsapp_senders;
  if (!sender?.session_name) return NextResponse.json({ error: "Selecione um número conectado para a campanha antes de editar os grupos." }, { status: 400 });

  let photoUrl: string | undefined;
  if (photo) {
    const bucket = String(photo.bucket || "");
    const storagePath = String(photo.storage_path || "");
    const mimeType = String(photo.mime_type || "");
    if (bucket !== "whatsapp-media" || !storagePath.startsWith(`accounts/${context.accountId}/uploads/`) || !IMAGE_MIMES.has(mimeType)) {
      return NextResponse.json({ error: "A foto enviada não é válida." }, { status: 400 });
    }
    const { data, error: signedError } = await sb.storage.from(bucket).createSignedUrl(storagePath, 10 * 60);
    if (signedError || !data?.signedUrl) return NextResponse.json({ error: signedError?.message || "Não foi possível preparar a foto." }, { status: 500 });
    photoUrl = data.signedUrl;
  }

  const groupJids = (campaign.campanha_grupos || []).map((group: any) => group.group_jid).filter(Boolean);
  if (!groupJids.length) return NextResponse.json({ error: "Esta campanha não possui grupos." }, { status: 400 });
  try {
    const result = await callWhatsappService(`/senders/${sender.session_name}/groups/update-profiles`, {
      method: "POST",
      body: JSON.stringify({ groupJids, ...(subject !== undefined ? { subject } : {}), ...(description !== undefined ? { description } : {}), ...(photoUrl ? { photoUrl } : {}) })
    });
    return NextResponse.json(result);
  } catch (currentError: any) {
    return NextResponse.json({ error: currentError?.message || "Não foi possível atualizar os grupos." }, { status: 503 });
  }
}
