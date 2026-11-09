import sharp, { type Sharp } from "sharp";
import {
  FREE_SHIPPING_BADGE_TEXT,
  formatDiscountBadge,
  sanitizeOfferBadges,
  type OfferBadges
} from "@disparei/affiliate-links/offer-badges";
import { BADGE_FONT } from "./badge-font.js";

export type { OfferBadges };

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
/** Foto enviada como imagem: lado maior até 1280 px, igual ao que o WhatsApp guarda. */
export const ORIGINAL_IMAGE_MAX_SIDE = 1280;

// Cores fortes e legíveis em celular: vermelho do desconto, verde do frete, texto branco.
const DISCOUNT_FILL = "#D7141A";
const FREE_SHIPPING_FILL = "#0A8A3A";
const TEXT_FILL = "#FFFFFF";
const OUTLINE = "#FFFFFF";

type GlyphMap = Record<string, { a: number; d: string }>;
const glyphs = BADGE_FONT.glyphs as unknown as GlyphMap;

/**
 * Texto como caminhos SVG a partir dos contornos da fonte embutida. Não usa
 * <text>: assim o selo não depende de fonte instalada no servidor.
 */
function textPaths(text: string, capHeightPx: number, x: number, baseline: number) {
  const scale = capHeightPx / BADGE_FONT.capHeight;
  const tracking = BADGE_FONT.unitsPerEm * 0.02;
  let cursor = 0;
  const parts: string[] = [];
  for (const char of text.toUpperCase()) {
    const glyph = glyphs[char] || glyphs[" "];
    if (glyph?.d) parts.push(`<path transform="translate(${(x + cursor * scale).toFixed(1)} ${baseline.toFixed(1)}) scale(${scale.toFixed(5)})" d="${glyph.d}"/>`);
    cursor += (glyph?.a || BADGE_FONT.unitsPerEm * 0.3) + tracking;
  }
  return { svg: parts.join(""), width: Math.max(0, cursor - tracking) * scale };
}

function measure(text: string, capHeightPx: number) {
  return textPaths(text, capHeightPx, 0, 0).width;
}

type Pill = { text: string; fill: string; capHeight: number; accentRoom: number };

function pill(spec: Pill, x: number, y: number, maxWidth: number, side: number) {
  let cap = spec.capHeight;
  const padX = () => cap * 0.5;
  // Texto que não cabe diminui até caber na largura da foto.
  while (cap > 8 && measure(spec.text, cap) + padX() * 2 > maxWidth) cap *= 0.92;
  const padTop = cap * (0.42 + spec.accentRoom);
  const padBottom = cap * 0.42;
  const height = cap + padTop + padBottom;
  const text = textPaths(spec.text, cap, x + padX(), y + padTop + cap);
  const width = text.width + padX() * 2;
  const radius = height * 0.2;
  const stroke = Math.max(2, side * 0.007);
  const shadow = Math.max(2, side * 0.008);
  return {
    height,
    width,
    svg: `<rect x="${(x + shadow).toFixed(1)}" y="${(y + shadow).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="${radius.toFixed(1)}" fill="#000" fill-opacity="0.28"/>`
      + `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="${radius.toFixed(1)}" fill="${spec.fill}" stroke="${OUTLINE}" stroke-width="${stroke.toFixed(1)}"/>`
      + `<g fill="${TEXT_FILL}">${text.svg}</g>`
  };
}

/**
 * Camada transparente com os selos para uma foto width x height. Desconto no
 * canto de cima à esquerda, frete grátis embaixo à esquerda, com margem de
 * segurança proporcional ao lado menor (vale para 800x800 e para foto original).
 */
export function renderBadgeOverlay(width: number, height: number, input: OfferBadges | null | undefined): string | null {
  const badges = sanitizeOfferBadges(input);
  if (!badges) return null;
  const side = Math.min(width, height);
  const margin = Math.round(side * 0.045);
  const maxWidth = width - margin * 2;
  const parts: string[] = [];
  const discount = formatDiscountBadge(badges.discountPercent);
  if (discount) parts.push(pill({ text: discount, fill: DISCOUNT_FILL, capHeight: side * 0.095, accentRoom: 0 }, margin, margin, maxWidth, side).svg);
  if (badges.freeShipping) {
    const spec: Pill = { text: FREE_SHIPPING_BADGE_TEXT, fill: FREE_SHIPPING_FILL, capHeight: side * 0.062, accentRoom: 0.24 };
    const probe = pill(spec, 0, 0, maxWidth, side);
    parts.push(pill(spec, margin, height - margin - probe.height, maxWidth, side).svg);
  }
  if (!parts.length) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

/** Aplica os selos numa imagem já no tamanho final. Sem selos, devolve a mesma imagem. */
export async function applyBadges(image: Sharp, width: number, height: number, badges: OfferBadges | null | undefined) {
  const overlay = renderBadgeOverlay(width, height, badges);
  return overlay ? image.composite([{ input: Buffer.from(overlay), top: 0, left: 0 }]) : image;
}

/**
 * Foto do produto enviada como imagem (modo "Imagem"): mantém a proporção,
 * limita o tamanho, tira transparência e desenha os selos. Sempre JPEG.
 */
export async function composeOriginalOfferImage(source: Buffer, badges: OfferBadges | null | undefined): Promise<Buffer> {
  const { data, info } = await sharp(source)
    .rotate()
    .resize(ORIGINAL_IMAGE_MAX_SIDE, ORIGINAL_IMAGE_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: WHITE })
    .toBuffer({ resolveWithObject: true });
  const image = await applyBadges(sharp(data), info.width, info.height, badges);
  return image.jpeg({ quality: 88 }).toBuffer();
}

/** Foto de exemplo da tela de Configurações: um produto desenhado, sem depender de rede. */
export function sampleProductImage(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <rect width="800" height="800" fill="#FFFFFF"/>
    <ellipse cx="400" cy="660" rx="230" ry="34" fill="#000" fill-opacity="0.10"/>
    <path d="M250 300 L400 230 L550 300 L550 590 L400 660 L250 590 Z" fill="#E9A23B"/>
    <path d="M400 370 L550 300 L550 590 L400 660 Z" fill="#C9822A"/>
    <path d="M250 300 L400 230 L550 300 L400 370 Z" fill="#F4C26B"/>
    <path d="M325 265 L475 335 L475 400 L445 414 L445 350 L295 280 Z" fill="#FFFFFF" fill-opacity="0.55"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}
