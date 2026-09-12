import { NextRequest, NextResponse } from "next/server";
import { clientIp, persistentRateLimit, requireAccountContext, requireValidOrigin } from "@/lib/security";
import { amazonLinkConversionSchema, amazonPartnerTagSchema } from "@/modules/integrations/schemas";
import { convertAmazonLink } from "@disparei/affiliate-links/amazon";
import { disconnectIntegration, getAmazonIntegration, saveAmazonIntegration } from "@/modules/integrations/server/service";
import { serverError } from "@/shared/http/responses";

export async function PUT(request: NextRequest) {
  const origin = requireValidOrigin(request); if (origin) return origin;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = amazonPartnerTagSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Informe um ID de Associado Amazon válido." }, { status: 400 });
  try { return NextResponse.json(await saveAmazonIntegration(context.database, context.accountId, context.session.userId!, parsed.data.partner_tag)); }
  catch (error) { return serverError(error, "Não foi possível salvar o ID de Associado Amazon."); }
}

export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request); if (origin) return origin;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const allowed = await persistentRateLimit(`${context.accountId}:${clientIp(request)}`, "amazon_link_conversion", 30, 60);
  if (!allowed) return NextResponse.json({ error: "Muitas tentativas. Aguarde um pouco." }, { status: 429 });
  const parsed = amazonLinkConversionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Cole um link válido da Amazon." }, { status: 400 });
  try {
    const integration = await getAmazonIntegration(context.database, context.accountId);
    if (integration?.status !== "connected" || !integration.affiliate_tag) return NextResponse.json({ error: "Configure seu ID de Associado Amazon antes de converter." }, { status: 400 });
    return NextResponse.json(await convertAmazonLink(parsed.data.url, integration.affiliate_tag));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível converter o link Amazon.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const origin = requireValidOrigin(request); if (origin) return origin;
  const context = await requireAccountContext(); if (context.error) return context.error;
  try { return NextResponse.json(await disconnectIntegration(context.database, context.accountId, "amazon")); }
  catch (error) { return serverError(error, "Não foi possível desconectar a Amazon."); }
}
