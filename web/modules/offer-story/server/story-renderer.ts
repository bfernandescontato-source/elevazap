import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { STORY_HEIGHT, STORY_WIDTH, escapeMarkup, type StoryModel } from "../story-layout";

/**
 * Desenha o story 9:16 (1080x1920, JPEG) com sharp.
 *
 * Os textos usam a fonte Poppins (licença SIL OFL 1.1, arquivo em
 * web/assets/fonts/OFL.txt) carregada pelo próprio arquivo: o contêiner Linux
 * do painel não tem fontes instaladas, e texto dentro de SVG dependeria delas.
 * As formas (cartão, selo, faixa) são SVG sem texto.
 *
 * Áreas de segurança: Status do WhatsApp e Stories do Instagram cobrem o topo
 * (~250 px) e a base (~200 px) com nome, barra de progresso e campo de resposta.
 */

const COLORS = {
  background: "#FBF6EC",
  card: "#FFFFFF",
  ink: "#14213D",
  muted: "#5B6170",
  price: "#0A7A3D",
  badge: "#FFC83D",
  ctaText: "#FFFFFF"
} as const;

const MARGIN = 80;
const CARD_TOP = 270;
const CTA_TOP = 1580;
const CTA_HEIGHT = 112;

type FontWeight = "ExtraBold" | "SemiBold";
type TextImage = { data: Buffer; width: number; height: number };
type Overlay = Parameters<ReturnType<typeof sharp>["composite"]>[0][number];

function fontFile(weight: FontWeight) {
  const name = `Poppins-${weight}.ttf`;
  // `next dev`/vitest rodam em web/; o build standalone roda na raiz do repositório.
  const candidates = [join(process.cwd(), "assets", "fonts", name), join(process.cwd(), "web", "assets", "fonts", name)];
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new Error(`Fonte ${name} não encontrada.`);
  return found;
}

async function text(markup: string, weight: FontWeight, size: number, color: string, width: number, align: "left" | "centre" = "centre"): Promise<TextImage> {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${color}">${markup}</span>`,
      font: `Poppins ${weight} ${size}`,
      fontfile: fontFile(weight),
      width,
      align,
      wrap: "word-char",
      rgba: true,
      dpi: 72
    }
  }).png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const svg = (body: string, width: number, height: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
const centered = (image: { width: number }) => Math.max(0, Math.round((STORY_WIDTH - image.width) / 2));

/** Título com até 3 linhas: se a fonte quebrar mais do que o previsto, diminui o tamanho. */
async function titleImage(lines: string[]) {
  const markup = lines.map(escapeMarkup).join("\n");
  for (const size of [58, 52, 46]) {
    const image = await text(markup, "ExtraBold", size, COLORS.ink, STORY_WIDTH - MARGIN * 2);
    if (image.height <= Math.ceil(size * 1.6 * lines.length)) return image;
  }
  return text(markup, "ExtraBold", 40, COLORS.ink, STORY_WIDTH - MARGIN * 2);
}

export async function renderOfferStory(model: StoryModel, photo: Buffer | null): Promise<Buffer> {
  const contentWidth = STORY_WIDTH - MARGIN * 2;
  const [chipText, title, oldLabel, oldPrice, newPrice, cta, link, badgeValue, badgeOff, placeholder] = await Promise.all([
    text(escapeMarkup(model.storeLabel.toUpperCase()), "ExtraBold", 36, "#FFFFFF", 700),
    titleImage(model.titleLines),
    model.oldPrice ? text("De", "SemiBold", 46, COLORS.muted, 200) : null,
    model.oldPrice ? text(escapeMarkup(model.oldPrice), "SemiBold", 46, COLORS.muted, contentWidth - 200) : null,
    model.newPrice ? text(`<span size="${48 * 1024}">Por </span>${escapeMarkup(model.newPrice)}`, "ExtraBold", 112, COLORS.price, contentWidth) : null,
    text(escapeMarkup(model.cta), "SemiBold", 46, COLORS.ctaText, contentWidth - 80),
    model.linkLabel ? text(`ou acesse ${escapeMarkup(model.linkLabel)}`, "SemiBold", 34, COLORS.ink, contentWidth) : null,
    model.discountLabel ? text(escapeMarkup(model.discountLabel), "ExtraBold", 60, COLORS.ink, 220) : null,
    model.discountLabel ? text("OFF", "ExtraBold", 32, COLORS.ink, 220) : null,
    photo ? null : text(escapeMarkup(model.storeLabel), "ExtraBold", 72, "#D9D3C7", contentWidth - 80)
  ]);

  // Altura do cartão da foto: o que sobra entre o topo e a faixa depois de
  // reservar título e preços, entre 520 e 800 px. O bloco de textos fica
  // centralizado no espaço entre o cartão e a faixa.
  const gap = 30;
  const oldHeight = oldPrice && oldLabel ? Math.max(oldPrice.height, oldLabel.height) : 0;
  const textBlock = title.height + (oldHeight ? oldHeight + gap / 2 : 0) + (newPrice ? newPrice.height + gap : 0);
  const cardHeight = Math.max(520, Math.min(800, CTA_TOP - CARD_TOP - textBlock - gap * 3));
  const cardBottom = CARD_TOP + cardHeight;

  const layers: Overlay[] = [];
  const chipWidth = chipText.width + 72; const chipHeight = 76; const chipTop = 160; const chipLeft = Math.round((STORY_WIDTH - chipWidth) / 2);
  layers.push({ input: svg(`<rect width="${chipWidth}" height="${chipHeight}" rx="38" fill="${COLORS.ink}"/>`, chipWidth, chipHeight), top: chipTop, left: chipLeft });
  layers.push({ input: chipText.data, top: chipTop + Math.round((chipHeight - chipText.height) / 2), left: chipLeft + 36 });

  layers.push({ input: svg(`<rect x="0" y="10" width="${contentWidth}" height="${cardHeight}" rx="56" fill="#000000" fill-opacity="0.07"/><rect width="${contentWidth}" height="${cardHeight}" rx="56" fill="${COLORS.card}"/>`, contentWidth, cardHeight + 10), top: CARD_TOP, left: MARGIN });
  let photoPlaced = false;
  if (photo) {
    const box = { width: contentWidth - 80, height: cardHeight - 80 };
    try {
      const fitted = await sharp(photo).rotate().resize(box.width, box.height, { fit: "inside" }).flatten({ background: COLORS.card }).png().toBuffer({ resolveWithObject: true });
      layers.push({ input: fitted.data, top: CARD_TOP + Math.round((cardHeight - fitted.info.height) / 2), left: MARGIN + Math.round((contentWidth - fitted.info.width) / 2) });
      photoPlaced = true;
    } catch { /* foto inválida: o cartão mostra só o nome da loja */ }
  }
  const fallback = placeholder || (!photoPlaced ? await text(escapeMarkup(model.storeLabel), "ExtraBold", 72, "#D9D3C7", contentWidth - 80) : null);
  if (fallback && !photoPlaced) layers.push({ input: fallback.data, top: CARD_TOP + Math.round((cardHeight - fallback.height) / 2), left: centered(fallback) });

  if (badgeValue && badgeOff) {
    const radius = 112; const centerX = STORY_WIDTH - radius - 30; const centerY = CARD_TOP + 10;
    layers.push({ input: svg(`<circle cx="${radius + 6}" cy="${radius + 6}" r="${radius}" fill="${COLORS.badge}" stroke="#FFFFFF" stroke-width="10"/>`, radius * 2 + 12, radius * 2 + 12), top: centerY - radius - 6, left: centerX - radius - 6 });
    const spacing = 8;
    const stack = badgeValue.height + spacing + badgeOff.height;
    const valueTop = centerY - Math.round(stack / 2);
    layers.push({ input: badgeValue.data, top: valueTop, left: centerX - Math.round(badgeValue.width / 2) });
    layers.push({ input: badgeOff.data, top: valueTop + badgeValue.height + spacing, left: centerX - Math.round(badgeOff.width / 2) });
  }

  let y = cardBottom + Math.max(gap, Math.round((CTA_TOP - cardBottom - textBlock) / 2));
  layers.push({ input: title.data, top: y, left: centered(title) }); y += title.height + gap;
  if (oldPrice && oldLabel) {
    // "De" sem risco; o preço antigo riscado à parte (não depende de a fonte ter tachado).
    const space = 16;
    const left = Math.max(0, Math.round((STORY_WIDTH - (oldLabel.width + space + oldPrice.width)) / 2));
    const priceLeft = left + oldLabel.width + space;
    layers.push({ input: oldLabel.data, top: y + oldHeight - oldLabel.height, left });
    layers.push({ input: oldPrice.data, top: y + oldHeight - oldPrice.height, left: priceLeft });
    layers.push({ input: svg(`<rect width="${oldPrice.width + 12}" height="5" rx="2" fill="${COLORS.muted}"/>`, oldPrice.width + 12, 5), top: y + oldHeight - Math.round(oldPrice.height * 0.5), left: priceLeft - 6 });
    y += oldHeight + gap / 2;
  }
  if (newPrice) layers.push({ input: newPrice.data, top: y, left: centered(newPrice) });

  const ctaWidth = contentWidth - 60; const ctaLeft = Math.round((STORY_WIDTH - ctaWidth) / 2);
  layers.push({ input: svg(`<rect width="${ctaWidth}" height="${CTA_HEIGHT}" rx="${CTA_HEIGHT / 2}" fill="${COLORS.price}"/>`, ctaWidth, CTA_HEIGHT), top: CTA_TOP, left: ctaLeft });
  layers.push({ input: cta.data, top: CTA_TOP + Math.round((CTA_HEIGHT - cta.height) / 2), left: centered(cta) });
  if (link) layers.push({ input: link.data, top: CTA_TOP + CTA_HEIGHT + 18, left: centered(link) });

  return sharp({ create: { width: STORY_WIDTH, height: STORY_HEIGHT, channels: 3, background: COLORS.background } })
    .composite(layers)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}
