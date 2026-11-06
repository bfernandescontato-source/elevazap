import { DEFAULT_OFFER_IMAGE_SETTINGS, type OfferImageSettings } from "@disparei/affiliate-links/offer-badges";
import { supabase } from "../supabase.js";
import { env } from "../env.js";
import { withTimeout } from "../utils/timeout.js";

const TTL_MS = 5 * 60_000;
type Entry = { value: OfferImageSettings; expiresAt: number };

/**
 * Configuração de imagem das ofertas por conta, em memória por 5 minutos. Um
 * disparo para 200 grupos faz no máximo uma consulta. Se a tabela não existir
 * ainda (migration não aplicada) ou a consulta falhar, vale o padrão: sem selos.
 */
export class OfferImageSettingsCache {
  private entries = new Map<string, Entry>();
  private inFlight = new Map<string, Promise<OfferImageSettings>>();

  constructor(private load: (accountId: string) => Promise<OfferImageSettings> = loadOfferImageSettings, private ttlMs = TTL_MS) {}

  async get(accountId: string): Promise<OfferImageSettings> {
    const now = Date.now();
    const cached = this.entries.get(accountId);
    if (cached && cached.expiresAt > now) return cached.value;
    const pending = this.inFlight.get(accountId);
    if (pending) return pending;
    const request = this.load(accountId)
      .catch(() => ({ ...DEFAULT_OFFER_IMAGE_SETTINGS }))
      .then(value => {
        this.entries.set(accountId, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.inFlight.delete(accountId));
    this.inFlight.set(accountId, request);
    if (this.entries.size > 5_000) for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
    return request;
  }
}

async function loadOfferImageSettings(accountId: string): Promise<OfferImageSettings> {
  const { data, error } = await withTimeout("queue.offer-image-settings", env.DB_TIMEOUT_MS,
    supabase.from("offer_image_settings").select("default_image_mode,discount_badge_enabled,free_shipping_badge_enabled")
      .eq("account_id", accountId).maybeSingle() as unknown as Promise<{ data: any; error: unknown }>);
  if (error || !data) return { ...DEFAULT_OFFER_IMAGE_SETTINGS };
  return {
    defaultImageMode: data.default_image_mode === "product_link_preview" ? "product_link_preview" : "original_image",
    discountBadge: data.discount_badge_enabled === true,
    freeShippingBadge: data.free_shipping_badge_enabled === true
  };
}

export const offerImageSettings = new OfferImageSettingsCache();
