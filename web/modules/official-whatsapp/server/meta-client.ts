import { env } from "@/lib/env";
import { OfficialWhatsAppError, type SanitizedMetaError } from "./errors";

function config() {
  const e = env();
  if (!e.META_ACCESS_TOKEN || !e.META_PHONE_NUMBER_ID || !e.META_GRAPH_VERSION) {
    throw new OfficialWhatsAppError("META_NOT_CONFIGURED", "Configure META_ACCESS_TOKEN, META_PHONE_NUMBER_ID e META_GRAPH_VERSION.");
  }
  return { token: e.META_ACCESS_TOKEN, phoneNumberId: e.META_PHONE_NUMBER_ID, wabaId: e.META_WABA_ID || null, version: e.META_GRAPH_VERSION };
}

export function metaConfigStatus() {
  const e = env();
  return {
    phoneNumberIdConfigured: Boolean(e.META_PHONE_NUMBER_ID),
    wabaConfigured: Boolean(e.META_WABA_ID),
    tokenConfigured: Boolean(e.META_ACCESS_TOKEN),
    graphVersion: e.META_GRAPH_VERSION || null
  };
}

export function metaIdentifiers() {
  const { phoneNumberId, wabaId } = config();
  return { phoneNumberId, wabaId };
}

// Nunca loga nem retorna META_ACCESS_TOKEN. Toda chamada à Graph API passa por aqui
// para centralizar versão, timeout e tradução de erros — sem hardcodar a versão em outros arquivos.
export async function graphRequest(path: string, init?: RequestInit) {
  const { token, version } = config();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    // Upload multipart (FormData) precisa que o fetch gere seu próprio content-type com
    // boundary — nunca forçar application/json nesse caso.
    const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
    response = await fetch(`https://graph.facebook.com/${version}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(isFormData ? {} : { "content-type": "application/json" }), ...(init?.headers || {}) },
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) throw new OfficialWhatsAppError("META_SEND_ERROR", "A Meta demorou demais para responder.");
    throw new OfficialWhatsAppError("META_SEND_ERROR", "Falha de rede ao chamar a Meta.");
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const metaError = data?.error;
    const code = response.status === 401 || metaError?.code === 190 ? "META_AUTH_ERROR" : "META_SEND_ERROR";
    // Allowlist explícito de campos de data.error — nunca inclui headers da requisição,
    // então o Authorization/token não tem como vazar aqui mesmo se o formato da Meta mudar.
    const sanitized: SanitizedMetaError = {
      httpStatus: response.status,
      code: metaError?.code,
      subcode: metaError?.error_subcode,
      type: metaError?.type,
      message: metaError?.message,
      errorData: metaError?.error_data,
      fbtraceId: metaError?.fbtrace_id
    };
    throw new OfficialWhatsAppError(code, metaError?.message || "Falha ao comunicar com a Meta.", sanitized);
  }
  return data;
}
