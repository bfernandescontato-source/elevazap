import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Versão publicada do painel (commit do deploy). O navegador compara com a que
// carregou para saber quando recarregar.
export function GET() {
  return NextResponse.json({ version: process.env.SOURCE_COMMIT || "dev" }, { headers: { "cache-control": "no-store" } });
}
