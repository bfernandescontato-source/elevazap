import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";

export async function signMercadoLivreOAuthState(secret: Uint8Array) {
  return new SignJWT({ jti: randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

export async function verifyMercadoLivreOAuthState(token: string, secret: Uint8Array): Promise<boolean> {
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}
