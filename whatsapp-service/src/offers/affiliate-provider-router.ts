import type { AffiliateProvider } from "./affiliate-provider.js";
import { UnsupportedAffiliateProviderError } from "./affiliate-provider.js";
import type { AffiliateProviderName } from "./types.js";

const HOST_PROVIDER = new Map<string, AffiliateProviderName>([
  ["shopee.com.br", "shopee"], ["www.shopee.com.br", "shopee"], ["s.shopee.com.br", "shopee"],
  ["mercadolivre.com.br", "mercado_livre"], ["www.mercadolivre.com.br", "mercado_livre"],
  ["produto.mercadolivre.com.br", "mercado_livre"], ["meli.la", "mercado_livre"]
]);

export function getAffiliateProviderName(value: string): AffiliateProviderName | "unsupported" {
  try { return HOST_PROVIDER.get(new URL(value).hostname.toLowerCase()) || "unsupported"; }
  catch { return "unsupported"; }
}

export class AffiliateProviderRouter {
  private readonly providers: Map<AffiliateProviderName, AffiliateProvider>;

  constructor(providers: AffiliateProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
  }

  getProvider(url: string) {
    const provider = Array.from(this.providers.values()).find((candidate) => candidate.supports(url));
    if (!provider) throw new UnsupportedAffiliateProviderError(`Marketplace não suportado para a URL informada.`);
    return provider;
  }
}
