/** Número só com dígitos, com DDI (ex.: 5511999998888). */
export function pairingPhoneDigits(raw: string) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 12 && digits.length <= 15 ? digits : "";
}

/** ABCDEFGH → ABCD-EFGH, como o WhatsApp mostra. */
export function formatPairingCode(code: string) {
  const clean = String(code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
