// Client-side DOCX import utility.
// Parses a .docx file into structured model data ready for the existing upload + model creation flow.
// .docx is a ZIP archive containing XML. We use jszip to unzip and DOMParser (built-in) for XML.

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A_DML = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

const VALID_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — same limit as schemas.ts validateMedia

export type ParsedImportModel = {
  nome: string;
  texto: string;
  imageFile: File | null;
  warnings: string[];
};

function extToMime(filename: string): string {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  return map[ext] ?? "image/jpeg";
}

// getElementsByTagNameNS with wildcard fallback — handles Pages/LibreOffice exports where
// the namespace prefix may differ from what DOMParser resolves.
function getElems(parent: Element | Document, ns: string, localName: string): Element[] {
  const result = Array.from(parent.getElementsByTagNameNS(ns, localName));
  if (result.length > 0) return result;
  // Fallback: match any namespace — Pages DOCX exports sometimes use default namespaces
  return Array.from(parent.getElementsByTagNameNS("*", localName));
}

function parseImageRels(xml: string): Map<string, string> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const map = new Map<string, string>();
  for (const el of getElems(doc, PKG_REL, "Relationship")) {
    const type = el.getAttribute("Type") ?? "";
    if (!type.endsWith("/image")) continue;
    const id = el.getAttribute("Id") ?? "";
    const target = el.getAttribute("Target") ?? "";
    if (id && target) map.set(id, target);
  }
  return map;
}

function boolProp(rPr: Element, localName: string): boolean {
  const els = getElems(rPr, W, localName);
  if (!els.length) return false;
  const val = els[0].getAttributeNS(W, "val") ?? els[0].getAttribute("w:val");
  return val !== "0" && val !== "false";
}

// Extracts formatted (WhatsApp markdown) text from a paragraph.
// Used for the actual message body lines after the NOME: marker.
function extractParaText(para: Element): string {
  let out = "";
  for (const run of getElems(para, W, "r")) {
    if (getElems(run, W, "drawing").length) continue;
    const rPrList = getElems(run, W, "rPr");
    const rPr = rPrList[0] ?? null;
    const bold = rPr ? boolProp(rPr, "b") : false;
    const italic = rPr ? boolProp(rPr, "i") : false;
    for (const t of getElems(run, W, "t")) {
      const s = t.textContent ?? "";
      if (!s) continue;
      out += bold && italic ? `*_${s}_*` : bold ? `*${s}*` : italic ? `_${s}_` : s;
    }
    if (getElems(run, W, "br").length) out += "\n";
  }
  // Fallback: if namespace queries found nothing, use plain textContent
  if (!out) {
    const raw = para.textContent ?? "";
    // Only use raw if there are no image drawings (which produce no visible text)
    if (getElems(para, A_DML, "blip").length === 0) out = raw;
  }
  return out;
}

// Extracts the relationship ID of the first image embedded in a paragraph.
function extractParaImageRId(para: Element): string | null {
  const blips = getElems(para, A_DML, "blip");
  if (!blips.length) return null;
  // r:embed attribute — try namespace-qualified first, then plain attribute
  return (
    blips[0].getAttributeNS(R_REL, "embed") ??
    blips[0].getAttribute("r:embed") ??
    null
  );
}

// Strips invisible Unicode characters that Pages/Word sometimes insert.
function stripInvisible(s: string): string {
  // Removes: zero-width space, ZWNJ, ZWJ, BOM, soft-hyphen, non-breaking space variants
  return s.replace(/[​-‍﻿­⁠]/g, "");
}

export async function parseDOCX(file: File): Promise<ParsedImportModel[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const relsEntry = zip.file("word/_rels/document.xml.rels");
  const imageRels = relsEntry
    ? parseImageRels(await relsEntry.async("string"))
    : new Map<string, string>();

  const docEntry = zip.file("word/document.xml");
  if (!docEntry) throw new Error("Arquivo inválido: word/document.xml não encontrado.");

  const docXml = await docEntry.async("string");
  const doc = new DOMParser().parseFromString(docXml, "application/xml");

  // DOMParser never throws — check for a parseerror document instead
  const parseErr = doc.getElementsByTagName("parsererror")[0];
  if (parseErr) throw new Error("O XML do documento está corrompido ou mal-formado.");

  const paragraphs = getElems(doc, W, "p");

  type Block = { nome: string; lines: string[]; firstRId: string | null };
  const blocks: Block[] = [];
  let cur: Block | null = null;

  for (const para of paragraphs) {
    // Use textContent for NOME: detection — immune to bold/italic/color formatting.
    // extractParaText would produce "*NOME: X*" for bold text, breaking the regex.
    const rawText = stripInvisible(para.textContent ?? "").trimStart();
    const rId = extractParaImageRId(para);

    // Match "NOME:" regardless of surrounding formatting, spaces, or alternative colons (：)
    if (/^NOME\s*[:：]\s*/i.test(rawText)) {
      if (cur) blocks.push(cur);
      const nome = rawText.replace(/^NOME\s*[:：]\s*/i, "").trim();
      cur = { nome, lines: [], firstRId: null };
    } else if (cur) {
      if (rId && !cur.firstRId) cur.firstRId = rId;
      // Use formatted text for message body — preserves WhatsApp bold/italic
      const formattedText = extractParaText(para);
      cur.lines.push(formattedText);
    }
  }
  if (cur) blocks.push(cur);

  if (!blocks.length) {
    throw new Error(
      'Nenhum marcador "NOME:" encontrado. ' +
      'Cada modelo deve começar com uma linha "NOME: Nome do Produto". ' +
      'Certifique-se de exportar o arquivo como .docx (Word) pelo Pages.'
    );
  }

  const models: ParsedImportModel[] = [];

  for (const block of blocks) {
    const warnings: string[] = [];
    if (!block.nome) warnings.push("Nome está vazio.");

    const texto = block.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!texto) warnings.push("Mensagem vazia.");

    let imageFile: File | null = null;

    if (block.firstRId) {
      const target = imageRels.get(block.firstRId);
      if (target) {
        const imgPath = target.startsWith("../") ? target.slice(3) : `word/${target}`;
        const imgEntry = zip.file(imgPath);
        if (imgEntry) {
          const blob = await imgEntry.async("blob");
          const fileName = target.split("/").pop() ?? "image.jpg";
          const mimeType = extToMime(fileName);
          if (!(VALID_IMAGE_MIMES as readonly string[]).includes(mimeType)) {
            warnings.push(`Formato de imagem não suportado (${mimeType}). Use JPEG, PNG ou WebP.`);
          } else if (blob.size > MAX_IMAGE_BYTES) {
            warnings.push("Imagem maior que 5 MB (limite do sistema).");
          } else {
            imageFile = new File([blob], fileName, { type: mimeType });
          }
        } else {
          warnings.push("Imagem referenciada não encontrada no arquivo .docx.");
        }
      } else {
        warnings.push("Referência de imagem inválida no documento.");
      }
    } else {
      warnings.push("Nenhuma imagem encontrada neste bloco.");
    }

    models.push({ nome: block.nome, texto, imageFile, warnings });
  }

  return models;
}
