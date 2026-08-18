import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation, requireInternalAdmin } from "@/lib/internal-admin";
import { createQuickReplyAction, listQuickReplyActions, type ButtonConfig, type QuickReplyAction } from "@/modules/official-whatsapp/server/quick-reply-actions";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const actions = await listQuickReplyActions();
  return NextResponse.json({ actions });
}

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_quick_reply_write_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as Record<string, any> | null;
  const payload = String(body?.payload || "").trim();
  const responseType = String(body?.responseType || "");
  if (!payload || !["text", "image", "video", "audio", "document"].includes(responseType)) {
    return NextResponse.json({ error: "Payload e tipo de resposta são obrigatórios." }, { status: 400 });
  }
  if (responseType === "text" && !String(body?.responseText || "").trim()) {
    return NextResponse.json({ error: "Mensagem de texto é obrigatória." }, { status: 400 });
  }
  if (responseType !== "text" && (!body?.mediaBucket || !body?.mediaPath)) {
    return NextResponse.json({ error: "Envie o arquivo de mídia." }, { status: 400 });
  }

  let buttonConfig: ButtonConfig | null = null;
  if (body?.buttonConfig && responseType !== "audio") {
    const bc = body.buttonConfig;
    if (bc.type === "url" && bc.text && bc.url) buttonConfig = { type: "url", text: String(bc.text), url: String(bc.url) };
    else if (bc.type === "quick_reply" && bc.text && bc.payload) buttonConfig = { type: "quick_reply", text: String(bc.text), payload: String(bc.payload) };
  }

  try {
    const action = await createQuickReplyAction({
      payload,
      buttonLabel: body?.buttonLabel || null,
      responseType: responseType as QuickReplyAction["response_type"],
      responseText: body?.responseText || null,
      mediaBucket: body?.mediaBucket || null,
      mediaPath: body?.mediaPath || null,
      mimeType: body?.mimeType || null,
      fileName: body?.fileName || null,
      caption: body?.caption || null,
      buttonConfig,
      active: body?.active !== false
    });
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao salvar." }, { status: 500 });
  }
}
