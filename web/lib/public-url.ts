import type { NextRequest } from "next/server";

const TRUSTED_HOST = /(^|\.)disparei\.pro$/i;

function firstValue(value: string | null) {
  return value?.split(",")[0]?.trim() || "";
}

function isTrustedHost(host: string) {
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  if (hostname === "localhost" || TRUSTED_HOST.test(hostname)) return true;
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || "").hostname.toLowerCase() === hostname;
  } catch {
    return false;
  }
}

// No modo standalone o Next monta request.url com o endereço interno do container
// (ex.: https://0.0.0.0:3000), então um redirect feito com new URL(path, request.url)
// leva o navegador para um endereço que não existe. O proxy (Traefik/Vercel) informa
// o endereço público em x-forwarded-*; só aceitamos hosts conhecidos para que um
// cabeçalho forjado não escolha o destino do redirect.
export function publicUrl(path: string, request: NextRequest) {
  const host = firstValue(request.headers.get("x-forwarded-host")) || firstValue(request.headers.get("host"));
  if (!host || !isTrustedHost(host)) return new URL(path, request.url);
  const protocol = firstValue(request.headers.get("x-forwarded-proto")) || new URL(request.url).protocol.replace(":", "");
  return new URL(path, `${protocol}://${host}`);
}
