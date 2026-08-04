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

export type AppSession = {
  userId: string | null;
  email: string;
  name: string | null;
  role: "admin" | "operator";
  source: "supabase" | "legacy";
};

export async function createSession(session?: Partial<AppSession>) {
  const e = env();
  const payload: AppSession = {
    userId: session?.userId || null,
    email: session?.email || e.ADMIN_EMAIL,
    name: session?.name || null,
    role: session?.role || "admin",
    source: session?.source || "legacy"
  };
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());

  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8
  });
}

export async function clearSession() {
  (await cookies()).delete(cookieName);
}

export async function getSession() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.email || !["admin", "operator"].includes(String(payload.role))) return null;
    return {
      userId: typeof payload.userId === "string" ? payload.userId : null,
      email: String(payload.email),
      name: typeof payload.name === "string" ? payload.name : null,
      role: payload.role as AppSession["role"],
      source: payload.source === "supabase" ? "supabase" as const : "legacy" as const
    };
  } catch {
    return null;
  }
}
