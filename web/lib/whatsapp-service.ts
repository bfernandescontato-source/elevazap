import { env } from "./env";

export async function callWhatsappService(path: string, init?: RequestInit) {
  const e = env();
  const response = await fetch(`${e.WHATSAPP_SERVICE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-api-key": e.INTERNAL_API_KEY,
      ...(init?.headers || {})
    },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Serviço WhatsApp indisponível.");
  return data;
}
