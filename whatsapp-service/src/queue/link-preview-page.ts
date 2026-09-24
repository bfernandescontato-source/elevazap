import { isAmazonUrl } from "@disparei/affiliate-links/amazon";

export const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const WHATSAPP_PREVIEW_USER_AGENT = "WhatsApp/2.23.20.0 A";

/**
 * Amazon's bot wall: a tiny page with a captcha form and none of the product
 * markup. Scraping it yields the generic "Amazon.com.br" title and no photo.
 */
export function isAmazonCaptchaPage(html: string): boolean {
  return /captcha/i.test(html) && !/id=["']landingImage["']/i.test(html) && !/og:image/i.test(html);
}


const SHOPEE_HOSTS = new Set(["shopee.com.br", "www.shopee.com.br", "s.shopee.com.br"]);
const MERCADO_LIVRE_HOST = /(^|\.)mercadolivre\.com\.br$/i;

/**
 * First Shopee / Amazon / Mercado Livre link in a message, so manual and
 * scheduled dispatches get the same product card as Piloto offers. Other
 * links are left to WhatsApp's default preview.
 */
export function findMarketplaceLink(text: string): string | undefined {
  for (const raw of text.match(/https?:\/\/[^\s<>"']+/gi) || []) {
    const link = raw.replace(/[),.!?;:]+$/g, "");
    let host: string;
    try { host = new URL(link).hostname.toLowerCase(); } catch { continue; }
    if (SHOPEE_HOSTS.has(host) || host === "meli.la" || MERCADO_LIVRE_HOST.test(host) || isAmazonUrl(link)) return link;
  }
  return undefined;
}
