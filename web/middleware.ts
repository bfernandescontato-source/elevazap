import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const protectedPaths = [
  "/dashboard",
  "/conexao",
  "/mensagem",
  "/grupos",
  "/lotes",
  "/envios",
  "/envios-grupo",
  "/incertos",
  "/configuracoes"
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", request.url));
  if (!protectedPaths.some((path) => pathname.startsWith(path))) return NextResponse.next();

  const token = request.cookies.get("elevazap_admin")?.value;
  if (!token || !process.env.AUTH_SECRET) return NextResponse.redirect(new URL("/login", request.url));
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET));
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/conexao/:path*", "/mensagem/:path*", "/grupos/:path*", "/lotes/:path*", "/envios/:path*", "/envios-grupo/:path*", "/incertos/:path*", "/configuracoes/:path*"]
};
