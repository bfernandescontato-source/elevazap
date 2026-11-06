import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { isConfirmedAffiliateUrl, type CatalogOfferProvider } from "@/modules/affiliate-catalog/schemas";
import { brasiliaDate } from "@/modules/affiliate-catalog/schedule-plan";
import type { AffiliateOffer } from "@/modules/affiliate-catalog/types";
import { buildStoryModel } from "../story-layout";
import type { StatusPostInput } from "../schemas";
import { fetchStoryPhoto } from "./story-photo";
import { renderOfferStory } from "./story-renderer";

/**
 * "Postar no Status": gera o story, guarda a imagem e cria UM envio comum na
 * fila de grupos do número, com destino status@broadcast. O whatsapp-service
 * reivindica, cadencia e confirma esse envio como qualquer outro; não existe
 * caminho paralelo de envio.
 */

export const STATUS_JID = "status@broadcast";
/** Postagens por número por dia (horário de Brasília). Evita encher o Status de quem vê. */
export const STATUS_DAILY_LIMIT = 10;
const MEDIA_BUCKET = "whatsapp-media";

export class StatusPostError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function renderStoryForOffer(offer: AffiliateOffer, fetcher?: typeof fetch) {
  const photo = await fetchStoryPhoto(offer.imageUrl, fetcher);
  return renderOfferStory(buildStoryModel(offer), photo);
}

/** Liberação por conta (accounts.whatsapp_status_enabled). Sem a coluna, fica desligado. */
export async function isWhatsappStatusEnabled(accountId: string) {
  const { data, error } = await supabaseAdmin().from("accounts").select("whatsapp_status_enabled").eq("id", accountId).maybeSingle();
  if (error) return false;
  return data?.whatsapp_status_enabled === true;
}

/** Início do dia em Brasília (o Brasil não tem horário de verão desde 2019). */
export function brasiliaDayStart(at: Date = new Date()) {
  return new Date(`${brasiliaDate(at)}T00:00:00-03:00`).toISOString();
}

type Sender = { id: string; session_name: string };
type Media = { bucket: string; path: string; size: number };

/** Linha da fila para o Status. Mesmos campos de um envio de imagem para grupo. */
export function buildStatusEnvio(input: { accountId: string; loteId: string; sender: Sender; media: Media; message: string; audienceGroupJids: string[]; scheduledAt: string }) {
  return {
    account_id: input.accountId,
    lote_id: input.loteId,
    whatsapp_sender_id: input.sender.id,
    whatsapp_session_name: input.sender.session_name,
    group_jid: STATUS_JID,
    nome_grupo: "Status do WhatsApp",
    tipo: "imagem",
    texto: null,
    legenda: input.message,
    media_bucket: input.media.bucket,
    media_path: input.media.path,
    mime_type: "image/jpeg",
    file_name: "story.jpg",
    file_size_bytes: input.media.size,
    status_audience_jids: Array.from(new Set(input.audienceGroupJids)),
    status: "pendente",
    priority: "high",
    scheduled_at: input.scheduledAt
  };
}

async function resolveSenderAndAudience(accountId: string, senderId: string, groupJids: string[]) {
  const sb = supabaseAdmin();
  const unique = Array.from(new Set(groupJids));
  const [{ data: sender }, { data: links }] = await Promise.all([
    sb.from("whatsapp_senders").select("id,session_name").eq("account_id", accountId).eq("id", senderId).maybeSingle(),
    // O número precisa estar nos grupos: é dele que vem a lista de quem vê.
    sb.from("whatsapp_sender_grupos").select("group_jid").eq("account_id", accountId).eq("whatsapp_sender_id", senderId).in("group_jid", unique)
  ]);
  if (!sender) throw new StatusPostError("Número não pertence à sua conta.", 403);
  if ((links || []).length !== unique.length) throw new StatusPostError("Escolha grupos em que este número participa.", 403);
  return { sender: sender as Sender, groupJids: unique };
}

export async function countStatusPostsToday(accountId: string, senderId: string) {
  const { count, error } = await supabaseAdmin().from("envios_grupo").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("whatsapp_sender_id", senderId).eq("group_jid", STATUS_JID)
    .gte("created_at", brasiliaDayStart()).neq("status", "cancelado");
  if (error) throw new StatusPostError("Não foi possível conferir o limite do dia.", 500);
  return count || 0;
}

export async function createStatusPost(input: StatusPostInput & { accountId: string }) {
  const { accountId, offer, message, senderId, audienceGroupJids } = input;
  if (!await isWhatsappStatusEnabled(accountId)) throw new StatusPostError("Postar no Status ainda não está liberado para sua conta.", 403);
  if (!isConfirmedAffiliateUrl(offer.provider as CatalogOfferProvider, offer.affiliateUrl) || !message.includes(offer.affiliateUrl!)) {
    throw new StatusPostError("A mensagem precisa ter o seu link de afiliado.", 400);
  }
  const { sender, groupJids } = await resolveSenderAndAudience(accountId, senderId, audienceGroupJids);
  if (await countStatusPostsToday(accountId, sender.id) >= STATUS_DAILY_LIMIT) {
    throw new StatusPostError(`Este número já postou ${STATUS_DAILY_LIMIT} status hoje. Tente amanhã.`, 429);
  }

  let image: Buffer;
  try { image = await renderStoryForOffer(offer); }
  catch { throw new StatusPostError("Não foi possível criar a imagem do story.", 422); }

  const sb = supabaseAdmin();
  const path = `accounts/${accountId}/stories/${randomUUID()}.jpg`;
  const upload = await sb.storage.from(MEDIA_BUCKET).upload(path, image, { contentType: "image/jpeg", upsert: false });
  if (upload.error) throw new StatusPostError("Não foi possível guardar a imagem do story.", 500);
  const media = { bucket: MEDIA_BUCKET, path, size: image.length };
  const when = new Date().toISOString();
  const removeImage = () => sb.storage.from(MEDIA_BUCKET).remove([path]);

  const { data: lote, error: loteError } = await sb.from("envios_grupo_lotes").insert({
    account_id: accountId, titulo: `Status · ${offer.name.slice(0, 90)}`, whatsapp_sender_id: sender.id, whatsapp_session_name: sender.session_name,
    tipo: "imagem", legenda: message, media_bucket: media.bucket, media_path: media.path, mime_type: "image/jpeg", file_name: "story.jpg", file_size_bytes: media.size,
    status: "pendente", priority: "high", total: 1, pendentes: 1, scheduled_at: when
  }).select("id").single();
  if (loteError || !lote) { await removeImage(); throw new StatusPostError("Não foi possível criar a postagem.", 500); }

  const { error: jobError } = await sb.from("envios_grupo").insert(buildStatusEnvio({ accountId, loteId: lote.id, sender, media, message, audienceGroupJids: groupJids, scheduledAt: when }));
  if (jobError) {
    await sb.from("envios_grupo_lotes").delete().eq("id", lote.id).eq("account_id", accountId);
    await removeImage();
    throw new StatusPostError("Não foi possível colocar a postagem na fila.", 500);
  }
  return { loteId: lote.id as string };
}
