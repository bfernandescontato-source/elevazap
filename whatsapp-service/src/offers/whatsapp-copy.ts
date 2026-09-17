/** Convert common Markdown produced by the source/AI into WhatsApp formatting. */
export function normalizeWhatsappOfferText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}[ \t]+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/~~([^~\n]+)~~/g, "~$1~")
    .replace(/__([^_\n]+)__/g, "_$1_")
    .replace(/[ \t]+\n/g, "\n");
}
