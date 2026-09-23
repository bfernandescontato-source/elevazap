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

/**
 * Reads width/height from a JPEG's SOF header. Baileys sometimes leaves them
 * empty on link thumbnails, and without them WhatsApp falls back to the small
 * side-thumbnail card instead of the large one.
 */
export function jpegDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return width && height ? { width, height } : undefined;
    }
    offset += 2 + length;
  }
  return undefined;
}
