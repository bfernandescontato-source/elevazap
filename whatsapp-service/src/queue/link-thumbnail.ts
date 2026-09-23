import axios from "axios";
import sharp from "sharp";
import { prepareWAMessageMedia } from "@whiskeysockets/baileys";

/** Every offer card photo is rendered on this square canvas, so all cards look the same. */
export const LINK_THUMBNAIL_SIZE = 800;
const SMALL_THUMBNAIL_SIZE = 192;
const BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 };

/**
 * Fits the product photo (any format/size: Shopee JPEG, Amazon 355–1500px,
 * Mercado Livre .webp) inside a fixed white square without cropping it, as
 * JPEG — the only format WhatsApp renders on link cards. Also returns the
 * small embedded thumbnail the phone falls back to if the large one fails.
 */
export async function standardizeLinkImage(source: Buffer): Promise<{ image: Buffer; thumbnail: Buffer }> {
  const image = await sharp(source)
    .rotate()
    .resize(LINK_THUMBNAIL_SIZE, LINK_THUMBNAIL_SIZE, { fit: "contain", background: BACKGROUND })
    .flatten({ background: BACKGROUND })
    .jpeg({ quality: 85 })
    .toBuffer();
  const thumbnail = await sharp(image).resize(SMALL_THUMBNAIL_SIZE, SMALL_THUMBNAIL_SIZE).jpeg({ quality: 60 }).toBuffer();
  return { image, thumbnail };
}

/**
 * Downloads a product photo, standardizes it and uploads it to WhatsApp as a
 * link-card thumbnail. The width/height and small thumbnail are always set
 * explicitly: Baileys sometimes leaves them empty, and WhatsApp then shows a
 * small card or no photo at all.
 */
export async function buildLinkThumbnail(imageUrl: string, upload: unknown) {
  const response = await axios.get<ArrayBuffer>(imageUrl, {
    timeout: 10_000, responseType: "arraybuffer", maxContentLength: 5_000_000, validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`Imagem do produto respondeu HTTP ${response.status}.`);
  if (!String(response.headers["content-type"] || "").startsWith("image/")) throw new Error("A URL da imagem do produto não devolveu uma imagem.");
  const { image, thumbnail } = await standardizeLinkImage(Buffer.from(response.data));
  const { imageMessage } = await prepareWAMessageMedia({ image }, {
    upload: upload as never,
    mediaTypeOverride: "thumbnail-link",
    options: { timeout: 10_000 }
  });
  if (!imageMessage) throw new Error("O WhatsApp não aceitou a imagem do produto.");
  Object.assign(imageMessage, { width: LINK_THUMBNAIL_SIZE, height: LINK_THUMBNAIL_SIZE, jpegThumbnail: thumbnail });
  return { jpegThumbnail: thumbnail, highQualityThumbnail: imageMessage };
}
