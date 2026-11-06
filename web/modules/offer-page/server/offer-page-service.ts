import { revalidateTag, unstable_cache } from "next/cache";
import type { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeStores, toPublicItems, toPublicPage, type PublicOfferPage } from "../public-mapper";
import { OFFER_PAGE_STORES } from "../offer-text";
import type { OfferPageSettingsInput } from "../schemas";
import { slugify, validateSlug } from "../slug";

type AccountContext = Exclude<Awaited<ReturnType<typeof requireAccountContext>>, { error: unknown }>;

export class OfferPageError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const AVATAR_BUCKET = "community-media";
const AVATAR_URL_SECONDS = 24 * 60 * 60;
const PUBLIC_CACHE_SECONDS = 60;
const SETTINGS_SELECT = "enabled,slug,title,bio,avatar_path,stores,updated_at";
export const offerPageTag = (slug: string) => `offer-page:${slug}`;

async function profileAvatarPath(context: AccountContext) {
  const auth = await supabaseAdmin().auth.admin.getUserById(context.session.userId!);
  const path = auth.data.user?.user_metadata?.avatar_path;
  // Só fotos enviadas por esta conta (mesma regra de /api/account).
  return typeof path === "string" && path.startsWith(`community/${context.accountId}/`) ? path : null;
}

async function signedAvatar(path: string | null) {
  if (!path) return null;
  const { data } = await supabaseAdmin().storage.from(AVATAR_BUCKET).createSignedUrl(path, AVATAR_URL_SECONDS);
  return data?.signedUrl || null;
}

/** Tela "Minha vitrine": configuração da própria conta (RLS) e prévia dos cards. */
export async function getOwnOfferPage(context: AccountContext) {
  const [{ data: settings, error }, { data: rows }, avatarPath, { data: user }] = await Promise.all([
    context.database.from("offer_page_settings").select(SETTINGS_SELECT).eq("account_id", context.accountId).maybeSingle(),
    context.database.from("offer_page_items").select("product_key,store,link,message,title,price,original_price,image_url,sent_at")
      .eq("account_id", context.accountId).gte("sent_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("sent_at", { ascending: false }).limit(200),
    profileAvatarPath(context),
    context.database.from("app_users").select("name").eq("id", context.session.userId).eq("account_id", context.accountId).maybeSingle()
  ]);
  if (error) throw new OfferPageError("Não foi possível carregar a vitrine.", 500);
  const stores = settings ? normalizeStores(settings.stores) : [...OFFER_PAGE_STORES];
  const name = user?.name || context.account?.name || "";
  const suggestion = slugify(name);
  return {
    settings: settings ? {
      enabled: Boolean(settings.enabled), slug: settings.slug as string, title: settings.title as string, bio: settings.bio as string,
      useProfilePhoto: Boolean(settings.avatar_path), stores
    } : null,
    suggestedSlug: validateSlug(suggestion).ok ? suggestion : "",
    suggestedTitle: name ? `Ofertas da ${name.split(/\s+/)[0]}`.slice(0, 60) : "Minhas ofertas",
    profilePhotoUrl: await signedAvatar(avatarPath),
    items: toPublicItems((rows || []) as any[], { stores })
  };
}

export async function saveOwnOfferPage(context: AccountContext, input: OfferPageSettingsInput) {
  const { data: previous } = await context.database.from("offer_page_settings").select("slug").eq("account_id", context.accountId).maybeSingle();
  const avatarPath = input.useProfilePhoto ? await profileAvatarPath(context) : null;
  const values = {
    account_id: context.accountId,
    enabled: input.enabled,
    slug: input.slug,
    title: input.title,
    bio: input.bio,
    avatar_path: avatarPath,
    stores: input.stores,
    updated_at: new Date().toISOString()
  };
  const { error } = await context.database.from("offer_page_settings").upsert(values, { onConflict: "account_id" });
  if (error?.code === "23505") throw new OfferPageError("Esse endereço já está em uso. Escolha outro.", 409);
  if (error) throw new OfferPageError("Não foi possível salvar a vitrine.", 500);
  revalidateTag(offerPageTag(input.slug));
  if (previous?.slug && previous.slug !== input.slug) revalidateTag(offerPageTag(previous.slug));
  return { created: !previous };
}

/** Um lote curto da carga inicial (a página chama de novo até done). Conta sempre da sessão. */
export async function backfillOwnOfferPage(accountId: string, cursor: { beforeSentAt?: string | null; beforeId?: string | null }) {
  const { data, error } = await supabaseAdmin().rpc("offer_page_backfill_account", {
    p_account_id: accountId,
    p_before_sent_at: cursor.beforeSentAt || null,
    p_before_id: cursor.beforeId || null,
    p_limit: 300
  });
  if (error) throw new OfferPageError("Não foi possível buscar suas ofertas enviadas.", 500);
  const result = (data || {}) as { scanned?: number; recorded?: number; done?: boolean; next_sent_at?: string | null; next_id?: string | null };
  return {
    scanned: Number(result.scanned || 0),
    recorded: Number(result.recorded || 0),
    done: result.done !== false,
    next: result.done === false ? { beforeSentAt: result.next_sent_at || null, beforeId: result.next_id || null } : null
  };
}

async function loadPublicOfferPage(slug: string): Promise<PublicOfferPage | null> {
  const { data, error } = await supabaseAdmin().rpc("offer_page_public", { p_slug: slug, p_limit: 200 });
  if (error) throw new OfferPageError("Vitrine indisponível.", 503);
  if (!data) return null;
  const avatarPath = typeof data.avatar_path === "string" ? data.avatar_path : null;
  return toPublicPage(data, await signedAvatar(avatarPath));
}

/** Página pública /v/<slug>: uma chamada ao banco a cada 60 s por endereço. */
export async function getPublicOfferPage(rawSlug: string) {
  let decoded = "";
  try { decoded = decodeURIComponent(rawSlug || ""); } catch { return null; }
  const check = validateSlug(decoded);
  if (!check.ok) return null;
  return unstable_cache(() => loadPublicOfferPage(check.slug), ["offer-page", check.slug], {
    revalidate: PUBLIC_CACHE_SECONDS,
    tags: [offerPageTag(check.slug)]
  })();
}
