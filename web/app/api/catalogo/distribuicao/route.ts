import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { dispatchOfferSchema } from "@/modules/affiliate-catalog/schemas";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_dispatch_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = dispatchOfferSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  const { offer, message, senderId, groupJids, scheduledAt } = parsed.data;
  const when = scheduledAt || new Date().toISOString();
  if (new Date(when).getTime() < Date.now() - 60_000) return NextResponse.json({ error: "Agendamento no passado." }, { status: 400 });
  const sb = supabaseAdmin();
  const [{ data: sender }, { data: groups }] = await Promise.all([
    sb.from("whatsapp_senders").select("id,session_name").eq("account_id", context.accountId).eq("id", senderId).maybeSingle(),
    sb.from("grupos").select("group_jid,nome").eq("account_id", context.accountId).in("group_jid", groupJids)
  ]);
  if (!sender || (groups || []).length !== new Set(groupJids).size) return NextResponse.json({ error: "Número ou grupo não pertence à sua conta." }, { status: 403 });
  let media: any = null;
  if (offer.imageUrl) {
    try {
      const image = await fetch(offer.imageUrl, { signal: AbortSignal.timeout(10_000) });
      const bytes = Buffer.from(await image.arrayBuffer());
      const mime = image.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      if (!image.ok || !mime.startsWith("image/") || bytes.length > 5 * 1024 * 1024) throw new Error();
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const path = `accounts/${context.accountId}/catalog/${randomUUID()}.${ext}`;
      const upload = await sb.storage.from("whatsapp-media").upload(path, bytes, { contentType: mime, upsert: false });
      if (upload.error) throw upload.error;
      media = { bucket: "whatsapp-media", path, mime, fileName: `oferta-shopee.${ext}`, size: bytes.length };
    } catch { return NextResponse.json({ error: "Não foi possível preparar a imagem do produto para envio." }, { status: 422 }); }
  }
  const type = media ? "imagem" : "texto";
  const { data: lote, error: loteError } = await sb.from("envios_grupo_lotes").insert({ account_id: context.accountId, titulo: `Oferta · ${offer.name.slice(0, 90)}`, whatsapp_sender_id: sender.id, whatsapp_session_name: sender.session_name, tipo: type, texto: type === "texto" ? message : null, legenda: type === "imagem" ? message : null, media_bucket: media?.bucket, media_path: media?.path, mime_type: media?.mime, file_name: media?.fileName, file_size_bytes: media?.size, status: "pendente", total: groupJids.length, pendentes: groupJids.length, scheduled_at: when }).select("id").single();
  if (loteError) return NextResponse.json({ error: "Não foi possível criar o envio." }, { status: 500 });
  const groupMap = new Map((groups || []).map((g: any) => [g.group_jid, g.nome]));
  const { data: jobs, error: jobsError } = await sb.from("envios_grupo").insert(groupJids.map(groupJid => ({ account_id: context.accountId, lote_id: lote.id, whatsapp_sender_id: sender.id, whatsapp_session_name: sender.session_name, group_jid: groupJid, nome_grupo: groupMap.get(groupJid), tipo: type, texto: type === "texto" ? message : null, legenda: type === "imagem" ? message : null, media_bucket: media?.bucket, media_path: media?.path, mime_type: media?.mime, file_name: media?.fileName, file_size_bytes: media?.size, status: "pendente", scheduled_at: when }))).select("id,group_jid");
  if (jobsError) { await sb.from("envios_grupo_lotes").delete().eq("id", lote.id); return NextResponse.json({ error: "Não foi possível criar os envios." }, { status: 500 }); }
  await sb.from("affiliate_offer_deliveries").insert((jobs || []).map((job: any) => ({ account_id: context.accountId, user_id: context.session.userId, provider: offer.provider, external_item_id: offer.externalItemId, group_id: job.group_jid, sender_id: sender.id, group_dispatch_id: job.id, scheduled_at: when, message, affiliate_url: offer.affiliateUrl, status: scheduledAt ? "scheduled" : "pending" })));
  return NextResponse.json({ ok: true, loteId: lote.id, total: groupJids.length, scheduledAt: when });
}
