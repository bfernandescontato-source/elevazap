import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { createMercadoLivreLinkWithSession, MercadoLivreSessionError } from "@disparei/affiliate-links/mercado-livre-session";
import { MercadoLivreUrlResolver } from "./mercado-livre-url-resolver.js";
import { decryptIntegrationSecret } from "../utils/integration-crypto.js";
import type { ResolvedAffiliateProduct } from "./types.js";

export class MercadoLivreSessionExpiredError extends Error {
  readonly code = "MERCADO_LIVRE_SESSION_EXPIRED";
}

export class MercadoLivreAffiliateService {
  readonly name = "mercado_livre" as const;
  constructor(private database: SupabaseClient, private resolver = new MercadoLivreUrlResolver()) {}

  supports(value: string) {
    try { return ["mercadolivre.com.br", "www.mercadolivre.com.br", "produto.mercadolivre.com.br", "meli.la"].includes(new URL(value).hostname.toLowerCase()); }
    catch { return false; }
  }

  resolveUrl(value: string) { return this.resolver.resolveUrl(value); }

  /**
   * Gera o meli.la pelo servidor com a sessão ML guardada (enviada pela
   * extensão). Funciona com o computador do afiliado desligado. Devolve null
   * quando não há sessão utilizável — aí o chamador cai na fila da extensão.
   * Se o ML recusar a sessão, marca session_status='invalid' para não insistir.
   */
  async generateViaStoredSession(integration: { id: string; accountId: string; encryptedCookies?: string | null; affiliateTag?: string | null }, product: ResolvedAffiliateProduct) {
    if (!integration.encryptedCookies) return null;
    let cookies: Record<string, string>;
    try { cookies = JSON.parse(decryptIntegrationSecret(integration.encryptedCookies)); }
    catch { return null; }
    try {
      return await createMercadoLivreLinkWithSession({ cookies, productUrl: product.resolvedUrl, tag: integration.affiliateTag });
    } catch (error) {
      if (error instanceof MercadoLivreSessionError && error.code === "SESSION_INVALID") {
        await this.database.from("affiliate_integrations").update({ session_status: "invalid", updated_at: new Date().toISOString() }).eq("id", integration.id).eq("account_id", integration.accountId);
      }
      return null; // qualquer falha da sessão cai na extensão (fallback), sem derrubar a oferta
    }
  }

  async generateAffiliateLink(product: ResolvedAffiliateProduct, input: {
    accountId: string; offerLinkId: string; affiliateTag?: string | null;
  }) {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString();
    const { data: job, error } = await this.database.from("affiliate_generation_jobs").insert({
      account_id: input.accountId, provider: "mercado_livre", offer_link_id: input.offerLinkId,
      kind: "conversion", input_url: product.resolvedUrl, affiliate_tag: input.affiliateTag || null,
      status: "pending", expires_at: expiresAt
    }).select("id").single();
    if (error) throw error;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      const { data: current, error: pollError } = await this.database.from("affiliate_generation_jobs")
        .select("status,affiliate_link,error_code,error_message").eq("id", job.id).eq("account_id", input.accountId).maybeSingle();
      if (pollError) throw pollError;
      if (current?.status === "completed" && current.affiliate_link) return current.affiliate_link as string;
      if (["failed", "expired"].includes(current?.status || "")) {
        if (/sessão|session|login|reconect/i.test(current?.error_message || "")) throw new MercadoLivreSessionExpiredError("Reconecte sua conta Mercado Livre.");
        throw new Error(current?.error_message || "O Mercado Livre não conseguiu gerar o link.");
      }
    }
    throw new Error("A extensão Mercado Livre não respondeu a tempo.");
  }

  cacheFingerprint(extensionTokenHash: string) {
    return createHash("sha256").update(`mercado_livre:${extensionTokenHash}`).digest("hex");
  }
}
