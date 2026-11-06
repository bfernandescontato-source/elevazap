/**
 * Baixa a foto do produto para o story. Só aceita HTTPS em hosts de imagem das
 * lojas do Catálogo, sem seguir redirecionamento, com prazo e tamanho máximos.
 * A URL vem do navegador, então nada fora dessa lista é buscado pelo servidor.
 */

const IMAGE_HOST_SUFFIXES = [
  "susercontent.com", // Shopee (down-br.img.susercontent.com)
  "cf.shopee.com.br",
  "mlstatic.com", // Mercado Livre
  "media-amazon.com", // Amazon (m.media-amazon.com)
  "ssl-images-amazon.com",
  "mlcdn.com.br", // Magalu (a-static.mlcdn.com.br)
  "magazineluiza.com.br"
];

const MAX_BYTES = 5 * 1024 * 1024;

export function isAllowedImageUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return IMAGE_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
  } catch { return false; }
}

/** Foto ou null: sem foto o story sai mesmo assim, só com os textos. */
export async function fetchStoryPhoto(imageUrl?: string, fetcher: typeof fetch = fetch): Promise<Buffer | null> {
  if (!isAllowedImageUrl(imageUrl)) return null;
  try {
    const response = await fetcher(imageUrl!, { redirect: "error", signal: AbortSignal.timeout(8_000) });
    const type = response.headers.get("content-type") || "";
    const declared = Number(response.headers.get("content-length") || 0);
    if (!response.ok || !type.startsWith("image/") || declared > MAX_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_BYTES ? bytes : null;
  } catch { return null; }
}
