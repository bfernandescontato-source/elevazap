import { createHash } from "crypto";

export function correlationId(value: unknown) {
  return createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 12);
}

export function errorFields(error: unknown) {
  const current = error as { message?: string; code?: string; name?: string };
  return {
    errorCode: current?.code || current?.name || "UNKNOWN_ERROR",
    errorMessage: current?.message || "Falha desconhecida."
  };
}
