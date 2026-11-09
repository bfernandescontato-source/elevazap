import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { publicUrl } from "./lib/public-url";

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
  "/comunidade",
  "/suporte",
  "/configuracoes",
  "/indique"
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/grupos") return NextResponse.redirect(new URL("/campanhas", request.url));
  // Link de indicação (https://www.disparei.pro/?ind=CODIGO) leva para a página de vendas.
  const referral = request.nextUrl.searchParams.get("ind");
  if (pathname === "/" && referral) {
    return NextResponse.redirect(publicUrl(`/home?ind=${encodeURIComponent(referral.slice(0, 20))}`, request));
  }
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
  matcher: ["/", "/dashboard/:path*", "/conexao/:path*", "/mensagem/:path*", "/grupos/:path*", "/campanhas/:path*", "/disparos/:path*", "/lotes/:path*", "/envios/:path*", "/envios-grupo/:path*", "/incertos/:path*", "/incidentes/:path*", "/piloto-automatico/:path*", "/catalogo/:path*", "/comunidade/:path*", "/suporte/:path*", "/configuracoes/:path*", "/indique/:path*", "/admin/:path*"]
};
