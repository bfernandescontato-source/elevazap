function enabled(value: string | undefined, fallback = false) {
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const offerFeatureFlags = {
  pilotAutomation: enabled(process.env.PILOT_AUTOMATION, true),
  shopeeLinkConversion: enabled(process.env.SHOPEE_LINK_CONVERSION),
  aiRewrite: enabled(process.env.AI_REWRITE),
  shopeeOfferFinder: enabled(process.env.SHOPEE_OFFER_FINDER)
} as const;
