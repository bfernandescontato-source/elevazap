import { offerBadgesKey, sanitizeOfferBadges, type OfferBadges } from "@disparei/affiliate-links/offer-badges";
import { callWhatsappServiceImage } from "@/lib/whatsapp-service";

function badgeQuery(badges: OfferBadges | null, mode: "card" | "original") {
  const query = new URLSearchParams({ mode });
  if (badges?.discountPercent) query.set("discount", String(badges.discountPercent));
  if (badges?.freeShipping) query.set("freeShipping", "1");
  return query.toString();
}

/**
 * Desenha os selos na foto do produto. O desenho roda no whatsapp-service (onde
 * o sharp e a fonte dos selos já estão), o mesmo código do card do link. Sem
 * selos, devolve null e a foto segue como veio.
 */
export async function composeOfferImageWithBadges(image: Buffer, mime: string, input: OfferBadges | null): Promise<Buffer | null> {
  const badges = sanitizeOfferBadges(input);
  if (!badges) return null;
  try {
    return await callWhatsappServiceImage(`/media/offer-image?${badgeQuery(badges, "original")}`, { body: image, contentType: mime });
  } catch (error) {
    console.warn({ event: "offer_badges_compose_failed", component: "offer-images", badges: offerBadgesKey(badges), error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export function renderBadgeSample(mode: "card" | "original", badges: OfferBadges | null) {
  return callWhatsappServiceImage(`/media/offer-badges/sample?${badgeQuery(sanitizeOfferBadges(badges), mode)}`);
}
