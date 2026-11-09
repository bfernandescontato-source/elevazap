import { DEFAULT_OFFER_IMAGE_SETTINGS, type OfferImageSettings } from "@disparei/affiliate-links/offer-badges";
import { supabaseAdmin } from "@/lib/supabase";

export type { OfferImageSettings };

function fromRow(row: any): OfferImageSettings {
  return {
    defaultImageMode: row?.default_image_mode === "product_link_preview" ? "product_link_preview" : "original_image",
    discountBadge: row?.discount_badge_enabled === true,
    freeShippingBadge: row?.free_shipping_badge_enabled === true
  };
}

/**
 * Configuração da conta. Sem linha, ou se a tabela ainda não existir no banco,
 * vale o padrão: formato Imagem e sem selos (igual ao comportamento antigo).
 */
export async function getOfferImageSettings(accountId: string): Promise<OfferImageSettings & { saved: boolean }> {
  const { data, error } = await supabaseAdmin().from("offer_image_settings")
    .select("default_image_mode,discount_badge_enabled,free_shipping_badge_enabled")
    .eq("account_id", accountId).maybeSingle();
  if (error || !data) return { ...DEFAULT_OFFER_IMAGE_SETTINGS, saved: false };
  return { ...fromRow(data), saved: true };
}

export class OfferImageSettingsError extends Error {}

export async function saveOfferImageSettings(accountId: string, userId: string | null, settings: OfferImageSettings): Promise<OfferImageSettings> {
  const { data, error } = await supabaseAdmin().from("offer_image_settings").upsert({
    account_id: accountId,
    default_image_mode: settings.defaultImageMode,
    discount_badge_enabled: settings.discountBadge,
    free_shipping_badge_enabled: settings.freeShippingBadge,
    updated_by: userId,
    updated_at: new Date().toISOString()
  }, { onConflict: "account_id" }).select("default_image_mode,discount_badge_enabled,free_shipping_badge_enabled").single();
  if (error || !data) throw new OfferImageSettingsError("Não foi possível salvar. Tente de novo.");
  return fromRow(data);
}
