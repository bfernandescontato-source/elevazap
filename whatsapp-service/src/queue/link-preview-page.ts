export const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const WHATSAPP_PREVIEW_USER_AGENT = "WhatsApp/2.23.20.0 A";

/**
 * Amazon's bot wall: a tiny page with a captcha form and none of the product
 * markup. Scraping it yields the generic "Amazon.com.br" title and no photo.
 */
export function isAmazonCaptchaPage(html: string): boolean {
  return /captcha/i.test(html) && !/id=["']landingImage["']/i.test(html) && !/og:image/i.test(html);
}

/**
 * WhatsApp only renders JPEG link thumbnails. Mercado Livre's og:image points
 * at a .webp file; its CDN serves the same photo as JPEG when the extension is
 * swapped, so ask for that instead of shipping a card the phone can't show.
 */
export function toJpegLinkThumbnailUrl(url: URL): URL {
  if (!/(^|\.)mlstatic\.com$/i.test(url.hostname) || !/\.webp$/i.test(url.pathname)) return url;
  const jpeg = new URL(url.toString());
  jpeg.pathname = jpeg.pathname.replace(/\.webp$/i, ".jpg");
  return jpeg;
}
