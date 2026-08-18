export type OfficialErrorCode =
  | "META_AUTH_ERROR"
  | "META_NOT_CONFIGURED"
  | "INVALID_PHONE"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_NOT_APPROVED"
  | "MISSING_TEMPLATE_VARIABLE"
  | "NO_AUTOMATION"
  | "DUPLICATE_EVENT"
  | "HUBLA_PARSE_ERROR"
  | "META_SEND_ERROR";

// Extraído apenas de campos conhecidos de data.error da Graph API (corpo da resposta),
// nunca de headers de requisição — o Authorization/token não passa por aqui.
export type SanitizedMetaError = {
  httpStatus?: number;
  code?: number;
  subcode?: number;
  type?: string;
  message?: string;
  errorData?: unknown;
  fbtraceId?: string;
};

export class OfficialWhatsAppError extends Error {
  code: OfficialErrorCode;
  metaError?: SanitizedMetaError;

  constructor(code: OfficialErrorCode, message: string, metaError?: SanitizedMetaError) {
    super(message);
    this.code = code;
    this.metaError = metaError;
  }
}

export const OFFICIAL_ERROR_LABELS: Record<OfficialErrorCode, string> = {
  META_AUTH_ERROR: "Falha de autenticação com a Meta.",
  META_NOT_CONFIGURED: "WhatsApp Oficial não está configurado.",
  INVALID_PHONE: "Telefone inválido.",
  TEMPLATE_NOT_FOUND: "Template não encontrado.",
  TEMPLATE_NOT_APPROVED: "Template não aprovado pela Meta.",
  MISSING_TEMPLATE_VARIABLE: "Faltam variáveis obrigatórias do template.",
  NO_AUTOMATION: "Nenhuma automação ativa para este evento.",
  DUPLICATE_EVENT: "Evento duplicado, ignorado.",
  HUBLA_PARSE_ERROR: "Não foi possível interpretar o payload da Hubla.",
  META_SEND_ERROR: "Falha ao enviar mensagem pela Meta."
};

export function officialErrorCode(error: unknown): OfficialErrorCode {
  return error instanceof OfficialWhatsAppError ? error.code : "META_SEND_ERROR";
}

export function officialErrorMessage(error: unknown): string {
  return error instanceof OfficialWhatsAppError ? error.message : OFFICIAL_ERROR_LABELS.META_SEND_ERROR;
}

export function officialErrorMetaDetails(error: unknown): SanitizedMetaError | undefined {
  return error instanceof OfficialWhatsAppError ? error.metaError : undefined;
}
