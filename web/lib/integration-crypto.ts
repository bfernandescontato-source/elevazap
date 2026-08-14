import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "./env";

function key() {
  const encoded = env().INTEGRATION_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Chave de criptografia de integrações não configurada.");
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32) throw new Error("Chave de criptografia de integrações inválida.");
  return value;
}

export function encryptIntegrationSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function credentialFingerprint(appId: string, secret: string) {
  return createHash("sha256").update(`${appId}:${secret}`).digest("hex");
}

export function decryptIntegrationSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Credencial criptografada inválida.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
