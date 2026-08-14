import { createDecipheriv } from "crypto";
import { env } from "../env.js";

function key() {
  const encoded = env.INTEGRATION_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Chave de criptografia de integrações não configurada.");
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32) throw new Error("Chave de criptografia de integrações inválida.");
  return value;
}

export function decryptIntegrationSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Credencial criptografada inválida.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
