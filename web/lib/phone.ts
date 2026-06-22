const VALID_DDDS = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "22", "24",
  "27", "28", "31", "32", "33", "34", "35", "37", "38", "41", "42", "43",
  "44", "45", "46", "47", "48", "49", "51", "53", "54", "55", "61", "62",
  "63", "64", "65", "66", "67", "68", "69", "71", "73", "74", "75", "77",
  "79", "81", "82", "83", "84", "85", "86", "87", "88", "89", "91", "92",
  "93", "94", "95", "96", "97", "98", "99"
]);

export function normalizeBrazilianPhone(input: string) {
  const digits = input.replace(/\D/g, "");
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  const ddd = withCountry.slice(2, 4);
  if (!withCountry.startsWith("55")) throw new Error("Telefone deve iniciar com 55.");
  if (!VALID_DDDS.has(ddd)) throw new Error("DDD inválido.");
  if (![12, 13].includes(withCountry.length)) throw new Error("Telefone brasileiro inválido.");
  return withCountry;
}

export function maskPhone(phone: string) {
  const normalized = normalizeBrazilianPhone(phone);
  return `${normalized.slice(0, 2)} ${normalized.slice(2, 4)} *****-${normalized.slice(-4)}`;
}

export function phoneToWhatsAppJid(phone: string) {
  return `${normalizeBrazilianPhone(phone)}@s.whatsapp.net`;
}

export function validateGroupJid(groupJid: string) {
  return /^\d+(-\d+)?@g\.us$/.test(groupJid);
}
