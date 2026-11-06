import { NextRequest, NextResponse } from "next/server";
import { offerShownPercent, selectOfferHook } from "@disparei/affiliate-links/offer-hooks";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { buildCatalogOfferMessage, catalogOfferFacts } from "@/modules/affiliate-catalog/offer-message";
import type { AffiliateOffer } from "@/modules/affiliate-catalog/types";
import { HookSettingsError, aiHookFor, getHookConfig, toHookSettings } from "@/modules/offer-hooks/server/hook-settings-service";

const SAMPLE_OFFER: AffiliateOffer = { provider: "SHOPEE", externalItemId: "exemplo", name: "Fone de Ouvido Bluetooth com Estojo", priceMin: 59.9, originalPrice: 119.9 };
const SAMPLE_LINK = "[seu link de afiliado]";

// Exemplo de mensagem com o modo salvo. Não gasta a vez do rodízio.
export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "offer_hooks_preview_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  try {
    const settings = toHookSettings(await getHookConfig(context.accountId));
    const facts = catalogOfferFacts(SAMPLE_OFFER);
    const aiHook = settings.mode === "ai" ? await aiHookFor(facts) : null;
    const sequence = settings.hooks.length ? Math.floor(Math.random() * settings.hooks.length * (settings.mixSystem ? 2 : 1)) : null;
    const hook = selectOfferHook(settings, { shownPercent: offerShownPercent(facts), sequence, aiHook });
    const message = buildCatalogOfferMessage(SAMPLE_OFFER, SAMPLE_LINK, Math.random, { settings: { ...settings, mode: "fixed", fixedHook: hook } });
    return NextResponse.json({ hook, message, usedAi: Boolean(aiHook) });
  } catch (error) {
    if (error instanceof HookSettingsError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
