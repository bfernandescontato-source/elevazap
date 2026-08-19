import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const protectedPaths = [
  "/dashboard",
  "/conexao",
  "/mensagem",
  "/grupos",
  "/campanhas",
  "/disparos",
  "/lotes",
  "/envios",
  "/envios-grupo",
  "/incertos",
  "/incidentes",
  "/piloto-automatico",
  "/catalogo",
  "/suporte",
  "/configuracoes"
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/grupos") return NextResponse.redirect(new URL("/campanhas", request.url));
  const isInternalAdminPath = pathname.startsWith("/admin");
  if (!isInternalAdminPath && !protectedPaths.some((path) => pathname.startsWith(path))) return NextResponse.next();

  const token = request.cookies.get("elevazap_admin")?.value;
  if (!token || !process.env.AUTH_SECRET) return NextResponse.redirect(new URL("/login", request.url));
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET));
    if (isInternalAdminPath) {
      const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
      if (!adminEmail || String(payload.email || "").toLowerCase() !== adminEmail) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/conexao/:path*", "/mensagem/:path*", "/grupos/:path*", "/campanhas/:path*", "/disparos/:path*", "/lotes/:path*", "/envios/:path*", "/envios-grupo/:path*", "/incertos/:path*", "/incidentes/:path*", "/piloto-automatico/:path*", "/catalogo/:path*", "/suporte/:path*", "/configuracoes/:path*", "/admin/:path*"]
};
