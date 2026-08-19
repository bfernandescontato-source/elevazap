import { normalizeBrazilianPhone } from "@/lib/phone";

export type RawContact = { phone?: string | null; name?: string | null; email?: string | null; product?: string | null };
export type ValidContact = { phone: string; name: string | null; email: string | null; product: string | null };

// Puro: sem rede/DB. Mesmo telefone (já normalizado) repetido conta como duplicado, não
// reenviado. Telefone que não normaliza com segurança conta como inválido, não bloqueia o resto.
export function classifyContacts(contacts: RawContact[]) {
  const seen = new Set<string>();
  const valid: ValidContact[] = [];
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const contact of contacts) {
    let phone: string;
    try {
      phone = normalizeBrazilianPhone(contact.phone || "");
    } catch {
      invalidCount += 1;
      continue;
    }
    if (seen.has(phone)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(phone);
    valid.push({ phone, name: contact.name || null, email: contact.email || null, product: contact.product || null });
  }

  return { totalRows: contacts.length, validCount: valid.length, duplicateCount, invalidCount, validContacts: valid };
}
