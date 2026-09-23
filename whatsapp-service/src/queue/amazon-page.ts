export const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const WHATSAPP_PREVIEW_USER_AGENT = "WhatsApp/2.23.20.0 A";

/**
 * Amazon's bot wall: a tiny page with a captcha form and none of the product
 * markup. Scraping it yields the generic "Amazon.com.br" title and no photo.
 */
export function isAmazonCaptchaPage(html: string): boolean {
  return /captcha/i.test(html) && !/id=["']landingImage["']/i.test(html) && !/og:image/i.test(html);
}
