import { env } from "./env";

export async function callWhatsappService(path: string, init?: RequestInit) {
  const e = env();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(`${e.WHATSAPP_SERVICE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-api-key": e.INTERNAL_API_KEY,
      ...(init?.headers || {})
    },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("O serviço WhatsApp demorou demais para responder.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Serviço WhatsApp indisponível.");
  return data;
}

/** Chamada que devolve imagem (JPEG) do serviço, opcionalmente mandando uma imagem. */
export async function callWhatsappServiceImage(path: string, input?: { body: Buffer; contentType: string }): Promise<Buffer> {
  const e = env();
  const response = await fetch(`${e.WHATSAPP_SERVICE_URL}${path}`, {
    method: input ? "POST" : "GET",
    headers: { "x-internal-api-key": e.INTERNAL_API_KEY, ...(input ? { "content-type": input.contentType } : {}) },
    body: input ? new Uint8Array(input.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
    throw new Error(`Serviço WhatsApp não devolveu a imagem (HTTP ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}
