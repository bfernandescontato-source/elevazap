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

function parseImageRels(xml: string): Map<string, string> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const map = new Map<string, string>();
  for (const el of Array.from(doc.getElementsByTagNameNS(PKG_REL, "Relationship"))) {
    const type = el.getAttribute("Type") ?? "";
    if (!type.endsWith("/image")) continue;
    const id = el.getAttribute("Id") ?? "";
    const target = el.getAttribute("Target") ?? "";
    if (id && target) map.set(id, target);
  }
  return map;
}

function boolProp(rPr: Element, localName: string): boolean {
  const els = rPr.getElementsByTagNameNS(W, localName);
  if (!els.length) return false;
  const val = els[0].getAttributeNS(W, "val");
  return val !== "0" && val !== "false";
}

function extractParaText(para: Element): string {
  let out = "";
  for (const run of Array.from(para.getElementsByTagNameNS(W, "r"))) {
    // Skip runs that contain drawings (images) — they produce no text
    if (run.getElementsByTagNameNS(W, "drawing").length) continue;
    const rPr = run.getElementsByTagNameNS(W, "rPr")[0];
    const bold = rPr ? boolProp(rPr, "b") : false;
    const italic = rPr ? boolProp(rPr, "i") : false;
    for (const t of Array.from(run.getElementsByTagNameNS(W, "t"))) {
      const s = t.textContent ?? "";
      if (!s) continue;
      // Convert Word bold/italic to WhatsApp markdown
      out += bold && italic ? `*_${s}_*` : bold ? `*${s}*` : italic ? `_${s}_` : s;
    }
    // Hard line break inside a run
    if (run.getElementsByTagNameNS(W, "br").length) out += "\n";
  }
  return out;
}

function extractParaImageRId(para: Element): string | null {
  const blips = para.getElementsByTagNameNS(A_DML, "blip");
  return blips.length ? (blips[0].getAttributeNS(R_REL, "embed") ?? null) : null;
}

export async function parseDOCX(file: File): Promise<ParsedImportModel[]> {
  // Dynamic import keeps jszip out of the initial bundle — loaded only on demand
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // Build image relationship map: rId → target path
  const relsEntry = zip.file("word/_rels/document.xml.rels");
  const imageRels = relsEntry
    ? parseImageRels(await relsEntry.async("string"))
    : new Map<string, string>();

  const docEntry = zip.file("word/document.xml");
  if (!docEntry) throw new Error("Arquivo inválido: word/document.xml não encontrado.");

  const docXml = await docEntry.async("string");
  const doc = new DOMParser().parseFromString(docXml, "application/xml");
  const paragraphs = Array.from(doc.getElementsByTagNameNS(W, "p"));

  // Group paragraphs into blocks delimited by "NOME:"
  type Block = { nome: string; lines: string[]; firstRId: string | null };
  const blocks: Block[] = [];
  let cur: Block | null = null;

  for (const para of paragraphs) {
    const text = extractParaText(para);
    const rId = extractParaImageRId(para);
    const trimmed = text.trimStart();

    if (/^NOME:\s*/i.test(trimmed)) {
      if (cur) blocks.push(cur);
      cur = { nome: trimmed.replace(/^NOME:\s*/i, "").trim(), lines: [], firstRId: null };
    } else if (cur) {
      if (rId && !cur.firstRId) cur.firstRId = rId;
      cur.lines.push(text); // empty lines (blank paragraphs) are kept as separators
    }
  }
  if (cur) blocks.push(cur);

  if (!blocks.length) throw new Error('Nenhum marcador "NOME:" encontrado. Verifique o formato do documento.');

  const models: ParsedImportModel[] = [];

  for (const block of blocks) {
    const warnings: string[] = [];
    if (!block.nome) warnings.push("Nome está vazio.");

    // Collapse 3+ consecutive newlines to a double newline, trim edges
    const texto = block.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!texto) warnings.push("Mensagem vazia.");

    let imageFile: File | null = null;

    if (block.firstRId) {
      const target = imageRels.get(block.firstRId);
      if (target) {
        // Target can be "media/image1.jpeg" (relative to word/) or "../media/..." (package-relative)
        const imgPath = target.startsWith("../")
          ? target.slice(3)
          : `word/${target}`;
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
