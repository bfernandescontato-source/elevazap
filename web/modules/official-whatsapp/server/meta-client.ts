import { OfficialWhatsAppError, type SanitizedMetaError } from "./errors";
import { parseMetaThroughputMps } from "./throughput";
import { legacyConnectionSummary, resolveOfficialConnection } from "./official-connections";

export function metaConfigStatus(connectionId?: string | null) {
  const legacy = !connectionId || connectionId === "legacy" ? legacyConnectionSummary() : null;
  return {
    phoneNumberIdConfigured: connectionId && connectionId !== "legacy" ? true : Boolean(legacy?.phone_number_id),
    wabaConfigured: connectionId && connectionId !== "legacy" ? true : Boolean(legacy?.waba_id),
    tokenConfigured: connectionId && connectionId !== "legacy" ? true : Boolean(legacy),
    graphVersion: connectionId && connectionId !== "legacy" ? null : legacy?.graph_version || null
  };
}

export async function metaIdentifiers(connectionId?: string | null, forSending = false) {
  const { phoneNumberId, wabaId } = await resolveOfficialConnection(connectionId, forSending);
  return { phoneNumberId, wabaId, connectionId: !connectionId || connectionId === "legacy" ? null : connectionId };
}

export async function getMetaMessageThroughput(connectionId?: string | null) {
  const { phoneNumberId } = await metaIdentifiers(connectionId);
  const data = await graphRequest(`/${phoneNumberId}?fields=throughput`, undefined, connectionId);
  return parseMetaThroughputMps(data?.throughput);
}

// Nunca loga nem retorna META_ACCESS_TOKEN. Toda chamada à Graph API passa por aqui
// para centralizar versão, timeout e tradução de erros — sem hardcodar a versão em outros arquivos.
export async function graphRequest(path: string, init?: RequestInit, connectionId?: string | null) {
  const { token, version } = await resolveOfficialConnection(connectionId);
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
