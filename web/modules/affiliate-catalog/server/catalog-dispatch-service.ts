import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { isConfirmedAffiliateUrl } from "../schemas";
import type { AffiliateOffer } from "../types";

export class CatalogDispatchError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type ImageMode = "original_image" | "product_link_preview";
type Media = { bucket: string; path: string; mime: string; fileName: string; size: number };

export type CatalogDispatchTarget = { senderId: string; groupJids: string[]; imageMode: ImageMode };
type Sender = { id: string; session_name: string };
type ResolvedTarget = { sender: Sender; groupJids: string[]; groupNames: Map<string, string | undefined> };

/** Número e grupos precisam ser da conta; resolvido uma vez por agendamento em massa. */
export async function resolveCatalogTarget(accountId: string, target: CatalogDispatchTarget): Promise<ResolvedTarget> {
  const sb = supabaseAdmin();
  const groupJids = Array.from(new Set(target.groupJids));
  const [{ data: sender }, { data: groups }] = await Promise.all([
    sb.from("whatsapp_senders").select("id,session_name").eq("account_id", accountId).eq("id", target.senderId).maybeSingle(),
    sb.from("grupos").select("group_jid,nome").eq("account_id", accountId).in("group_jid", groupJids)
  ]);
  if (!sender || (groups || []).length !== groupJids.length) throw new CatalogDispatchError("Número ou grupo não pertence à sua conta.", 403);
  return { sender: sender as Sender, groupJids, groupNames: new Map((groups || []).map((group: any) => [group.group_jid, group.nome])) };
}

async function uploadOfferImage(accountId: string, offer: AffiliateOffer): Promise<Media | null> {
  if (!offer.imageUrl) return null;
  try {
    const image = await fetch(offer.imageUrl, { signal: AbortSignal.timeout(10_000) });
    const bytes = Buffer.from(await image.arrayBuffer());
    const mime = image.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!image.ok || !mime.startsWith("image/") || bytes.length > 5 * 1024 * 1024) throw new Error();
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const path = `accounts/${accountId}/catalog/${randomUUID()}.${ext}`;
    const upload = await supabaseAdmin().storage.from("whatsapp-media").upload(path, bytes, { contentType: mime, upsert: false });
    if (upload.error) throw upload.error;
    return { bucket: "whatsapp-media", path, mime, fileName: `oferta-${offer.provider.toLowerCase()}.${ext}`, size: bytes.length };
  } catch {
    throw new CatalogDispatchError("Não foi possível preparar a imagem do produto para envio.", 422);
  }
}

/**
 * Cria o lote de uma oferta do Catálogo (um envio por grupo) e registra o produto
 * na Agenda. O whatsapp-service envia cada linha quando chega o horário.
 */
export async function createCatalogDispatch(input: {
  accountId: string; userId: string | null; offer: AffiliateOffer; message: string;
  target: ResolvedTarget; imageMode: ImageMode; scheduledAt?: string;
}) {
  const { accountId, userId, offer, message, target, imageMode } = input;
  if (!isConfirmedAffiliateUrl(offer.provider as "SHOPEE" | "MERCADO_LIVRE", offer.affiliateUrl) || !message.includes(offer.affiliateUrl!)) {
    throw new CatalogDispatchError("A oferta precisa conter o link afiliado confirmado.", 400);
  }
  const when = input.scheduledAt || new Date().toISOString();
  if (new Date(when).getTime() < Date.now() - 60_000) throw new CatalogDispatchError("Agendamento no passado.", 400);

  // No modo preview a URL segue no texto; não baixamos nem anexamos a imagem.
  // Assim o Baileys monta o card nativo do WhatsApp a partir do link afiliado.
  const media = imageMode === "original_image" ? await uploadOfferImage(accountId, offer) : null;
  const type = media ? "imagem" : "texto";
  const { sender, groupJids, groupNames } = target;
  const content = { tipo: type, texto: type === "texto" ? message : null, legenda: type === "imagem" ? message : null, media_bucket: media?.bucket, media_path: media?.path, mime_type: media?.mime, file_name: media?.fileName, file_size_bytes: media?.size };
  const sb = supabaseAdmin();

  const { data: lote, error: loteError } = await sb.from("envios_grupo_lotes").insert({ account_id: accountId, titulo: `Oferta · ${offer.name.slice(0, 90)}`, whatsapp_sender_id: sender.id, whatsapp_session_name: sender.session_name, ...content, status: "pendente", total: groupJids.length, pendentes: groupJids.length, scheduled_at: when }).select("id").single();
  if (loteError) throw new CatalogDispatchError("Não foi possível criar o envio.", 500);
  const { data: jobs, error: jobsError } = await sb.from("envios_grupo").insert(groupJids.map(groupJid => ({ account_id: accountId, lote_id: lote.id, whatsapp_sender_id: sender.id, whatsapp_session_name: sender.session_name, group_jid: groupJid, nome_grupo: groupNames.get(groupJid), ...content, status: "pendente", scheduled_at: when }))).select("id,group_jid");
  if (jobsError) {
    await sb.from("envios_grupo_lotes").delete().eq("id", lote.id).eq("account_id", accountId);
    throw new CatalogDispatchError("Não foi possível criar os envios.", 500);
  }
  await sb.from("affiliate_offer_deliveries").insert((jobs || []).map((job: any) => ({ account_id: accountId, user_id: userId, provider: offer.provider, external_item_id: offer.externalItemId, group_id: job.group_jid, sender_id: sender.id, group_dispatch_id: job.id, scheduled_at: when, message, affiliate_url: offer.affiliateUrl, status: input.scheduledAt ? "scheduled" : "pending" })));
  const { data: agendaItem, error: agendaError } = await sb.from("catalog_scheduled_offers").insert({ account_id: accountId, user_id: userId, lote_id: lote.id, provider: offer.provider, external_item_id: offer.externalItemId, product_name: offer.name.slice(0, 500), image_url: offer.imageUrl ?? null, price: offer.priceMin ?? null, original_price: offer.originalPrice ?? null, affiliate_url: offer.affiliateUrl, message, whatsapp_sender_id: sender.id, group_count: groupJids.length, scheduled_at: when }).select("id").single();
  // O envio já está na fila; a Agenda é só a vitrine dele, então uma falha aqui não desfaz o lote.
  if (agendaError) console.error({ event: "catalog_agenda_record_failed", component: "affiliate-catalog", account_id: accountId, lote_id: lote.id, code: agendaError.code });
  return { loteId: lote.id as string, agendaId: (agendaItem?.id as string | undefined) ?? null, total: groupJids.length, scheduledAt: when };
}
