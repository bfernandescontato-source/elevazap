import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { pollMercadoLivreAffiliateLink } from "@/modules/affiliate-catalog/server/mercado-livre-link-service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const context = await requireAccountContext(); if (context.error) return context.error;
  const { jobId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
  try { return NextResponse.json(await pollMercadoLivreAffiliateLink(context.database, context.accountId, jobId)); }
  catch (error) {
    const code = error instanceof Error ? error.message : "MERCADO_LIVRE_LINK_ERROR";
    return NextResponse.json({ error: code === "MERCADO_LIVRE_EXTENSION_NOT_CONNECTED" ? "Reconecte a extensão do Mercado Livre." : "Não foi possível consultar o link afiliado.", code }, { status: 503 });
  }
}
