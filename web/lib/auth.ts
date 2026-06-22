import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { env } from "./env";

const cookieName = "elevazap_admin";

function secret() {
  return new TextEncoder().encode(env().AUTH_SECRET);
}

export async function verifyPassword(email: string, password: string) {
  const e = env();
  if (email.toLowerCase() !== e.ADMIN_EMAIL.toLowerCase()) return false;
  return bcrypt.compare(password, e.ADMIN_PASSWORD_HASH);
}

export async function createSession() {
  const token = await new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());

  cookies().set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8
  });
}

export function clearSession() {
  cookies().delete(cookieName);
}

export async function getSession() {
  const token = cookies().get(cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.role === "admin" ? { role: "admin" as const } : null;
  } catch {
    return null;
  }
}
