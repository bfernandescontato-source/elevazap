import type { SupabaseClient } from "@supabase/supabase-js";
import { convertAmazonLink } from "@disparei/affiliate-links/amazon";
import { decryptIntegrationSecret } from "@/lib/integration-crypto";
import { getAmazonIntegration, getShopeeIntegrationCredentials } from "@/modules/integrations/server/service";
import { shopeeGraphQl } from "@/modules/offer-autopilot/server/shopee-client";
import { isConfirmedAffiliateUrl, MAGAZINE_VOCE_PATH } from "../schemas";

/** Erro com mensagem pronta para a tela. */
export class StoreLinkError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

const graphQlString = (value: string) => JSON.stringify(value);

/** Produto da Shopee capturado pela extensão: link curto pela API de afiliados da própria conta. */
export async function shopeeAffiliateLink(database: SupabaseClient, accountId: string, productUrl: string) {
  const url = new URL(productUrl);
  if (!/(^|\.)shopee\.com\.br$/i.test(url.hostname)) throw new StoreLinkError("Endereço da Shopee inválido.", 400);
  const credentials = await getShopeeIntegrationCredentials(database, accountId);
  if (!credentials || credentials.status !== "connected") throw new StoreLinkError("Conecte sua conta de afiliado Shopee em Integrações para gerar o link.", 409);
  const query = `mutation { generateShortLink(input: { originUrl: ${graphQlString(`${url.origin}${url.pathname}`)}, subIds: ["disparei"] }) { shortLink } }`;
  try {
    const data = await shopeeGraphQl<{ generateShortLink?: { shortLink?: string } }>(credentials.app_id, decryptIntegrationSecret(credentials.encrypted_app_secret), query);
    const link = data.generateShortLink?.shortLink;
    if (!link || !isConfirmedAffiliateUrl("SHOPEE", link)) throw new Error("SHOPEE_UNAVAILABLE");
    return link;
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SHOPEE_AUTH") throw new StoreLinkError("A Shopee recusou suas credenciais. Reconecte em Integrações.", 409);
    if (code === "SHOPEE_RATE_LIMIT") throw new StoreLinkError("Limite de chamadas da Shopee atingido. Tente de novo em alguns minutos.", 429);
    throw new StoreLinkError("A Shopee não gerou o link afiliado deste produto.", 503);
  }
}

/** Amazon: ID de Associado da conta (Integrações › Amazon), igual ao Piloto. */
export async function amazonAffiliateLink(database: SupabaseClient, accountId: string, productUrl: string) {
  const integration = await getAmazonIntegration(database, accountId);
  if (integration?.status !== "connected" || !integration.affiliate_tag) throw new StoreLinkError("Configure seu ID de Associado Amazon em Integrações para gerar o link.", 409);
  try { return (await convertAmazonLink(productUrl, integration.affiliate_tag)).affiliate_url as string; }
  catch (error) { throw new StoreLinkError(error instanceof Error ? error.message : "Não foi possível converter o link Amazon.", 400); }
}

/** Magalu: só produto aberto pela loja Magazine Você do afiliado; o link dela já paga comissão. */
export function magaluAffiliateLink(productUrl: string) {
  const url = new URL(productUrl);
  if (!/(^|\.)magazinevoce\.com\.br$/i.test(url.hostname) || !MAGAZINE_VOCE_PATH.test(url.pathname)) {
    throw new StoreLinkError("Abra o produto pela sua loja Magazine Você (magazinevoce.com.br/sua-loja) para ter o link de afiliado.");
  }
  return `https://www.magazinevoce.com.br${url.pathname}`;
}
