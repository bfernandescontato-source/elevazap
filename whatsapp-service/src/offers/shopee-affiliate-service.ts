import axios from "axios";
import { createHash } from "crypto";
import { ShopeeUrlResolver, extractShopeeProductIdentifiers, sanitizeShopeeProductUrl, type ShopeeProductIdentifiers } from "./shopee-url-resolver.js";

export type ShopeeCredentials = { appId: string; appSecret: string };
export type AffiliateMetadata = Record<string, string>;
export type ShopeeRequestErrorKind = "authentication" | "rate_limit" | "invalid_request" | "business" | "transient";

export class ShopeeRequestError extends Error {
  constructor(message: string, readonly kind: ShopeeRequestErrorKind, readonly retryable: boolean, readonly code?: number, readonly retryAfterMs?: number) { super(message); }
}

export interface ShopeeAffiliateService {
  resolveUrl(url: string): Promise<string>;
  normalizeProductUrl(url: string): string;
  extractProductIdentifiers(url: string): ShopeeProductIdentifiers;
  generateAffiliateLink(url: string, credentials: ShopeeCredentials, metadata?: AffiliateMetadata): Promise<string>;
}

type GraphQlResponse = { data?: { generateShortLink?: { shortLink?: string } }; errors?: Array<{ message?: string; extensions?: { code?: number; message?: string } }> };
const ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";

function wait(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function safeSubIds(metadata: AffiliateMetadata = {}) {
  return Object.entries(metadata).slice(0, 5).map(([key, value]) => `${key}-${value}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64));
}
function graphQlString(value: string) { return JSON.stringify(value); }

export class RealShopeeAffiliateService implements ShopeeAffiliateService {
  private resolver = new ShopeeUrlResolver();
  constructor(private sleep: (milliseconds: number) => Promise<unknown> = wait) {}

  resolveUrl(url: string) { return this.resolver.resolveUrl(url); }
  normalizeProductUrl(url: string) { return sanitizeShopeeProductUrl(url); }
  extractProductIdentifiers(url: string) { return extractShopeeProductIdentifiers(url); }

  async generateAffiliateLink(url: string, credentials: ShopeeCredentials, metadata: AffiliateMetadata = {}) {
    const originUrl = this.normalizeProductUrl(url);
    const subIds = safeSubIds(metadata);
    const query = `mutation { generateShortLink(input: { originUrl: ${graphQlString(originUrl)}, subIds: [${subIds.map(graphQlString).join(",")}] }) { shortLink } }`;
    const payload = JSON.stringify({ query });
    const delays = [0, 5_000, 30_000, 120_000];
    let lastError: unknown;
    let retryAfterMs = 0;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      const delay = Math.max(delays[attempt], retryAfterMs);
      if (delay) await this.sleep(delay);
      try { return await this.request(payload, credentials); }
      catch (error) {
        lastError = error;
        retryAfterMs = error instanceof ShopeeRequestError ? error.retryAfterMs || 0 : 0;
        if (!(error instanceof ShopeeRequestError) || !error.retryable || attempt === delays.length - 1) throw error;
      }
    }
    throw lastError;
  }

  private async request(payload: string, credentials: ShopeeCredentials) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHash("sha256").update(`${credentials.appId}${timestamp}${payload}${credentials.appSecret}`).digest("hex");
    try {
      const response = await axios.post<GraphQlResponse>(ENDPOINT, payload, {
        timeout: 10_000,
        headers: {
          "content-type": "application/json",
          authorization: `SHA256 Credential=${credentials.appId}, Timestamp=${timestamp}, Signature=${signature}`
        },
        validateStatus: () => true
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers["retry-after"] || 0);
        throw new ShopeeRequestError("Shopee temporariamente indisponível.", response.status === 429 ? "rate_limit" : "transient", true, undefined, retryAfter > 0 ? retryAfter * 1000 : undefined);
      }
      const apiError = response.data?.errors?.[0];
      if (apiError) throw this.mapApiError(apiError.extensions?.code, apiError.extensions?.message || apiError.message);
      const shortLink = response.data?.data?.generateShortLink?.shortLink;
      if (!shortLink || !/^https:\/\//i.test(shortLink)) throw new ShopeeRequestError("A Shopee não retornou um link afiliado válido.", "business", false);
      return shortLink;
    } catch (error) {
      if (error instanceof ShopeeRequestError) throw error;
      if (axios.isAxiosError(error)) throw new ShopeeRequestError("Falha temporária ao acessar a Shopee.", "transient", true);
      throw error;
    }
  }

  private mapApiError(code?: number, detail?: string) {
    if (code === 10020) return new ShopeeRequestError("Credenciais Shopee inválidas ou assinatura expirada.", "authentication", false, code);
    if (code === 10030) return new ShopeeRequestError("Limite de chamadas da Shopee atingido.", "rate_limit", true, code);
    if (code === 10010) return new ShopeeRequestError("A Shopee rejeitou os dados da solicitação.", "invalid_request", false, code);
    if (code === 10000) return new ShopeeRequestError("Erro temporário da Shopee.", "transient", true, code);
    return new ShopeeRequestError(detail ? "A Shopee não conseguiu processar este link." : "Falha na geração do link Shopee.", "business", false, code);
  }
}
