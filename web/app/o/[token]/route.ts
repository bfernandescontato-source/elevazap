import { NextRequest, NextResponse } from "next/server";
import { getTrackedFinalDestination, resolveAndRecordTrackedFinalLink, verifyTrackedLinkToken } from "@/modules/official-whatsapp/server/tracked-links";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow"
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const flowRunId = verifyTrackedLinkToken(token);
  if (!flowRunId) return NextResponse.json({ error: "Link inválido." }, { status: 404, headers: NO_STORE_HEADERS });

  // Se o registro do clique falhar momentaneamente, o cliente ainda chega ao grupo.
  try {
    const destination = await resolveAndRecordTrackedFinalLink(token);
    if (!destination) return NextResponse.json({ error: "Link não encontrado." }, { status: 404, headers: NO_STORE_HEADERS });
    return NextResponse.redirect(destination, { status: 302, headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[official-whatsapp] Falha ao registrar clique final:", error);
    const destination = await getTrackedFinalDestination(flowRunId).catch(() => null);
    if (!destination) return NextResponse.json({ error: "Link indisponível." }, { status: 503, headers: NO_STORE_HEADERS });
    return NextResponse.redirect(destination, { status: 302, headers: NO_STORE_HEADERS });
  }
}
