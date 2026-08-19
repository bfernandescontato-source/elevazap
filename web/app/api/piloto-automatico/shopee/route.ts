import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { shopeeIntegrationSchema } from "@/modules/offer-autopilot/schemas";
import { connectShopeeIntegration } from "@/modules/integrations/server/service";

export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = shopeeIntegrationSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Informe App ID e App Secret válidos." }, { status: 400 });
  try {
    return NextResponse.json(await connectShopeeIntegration(context.database, context.accountId, context.session.userId!, parsed.data));
  } catch (error) {
    const message = error instanceof Error && error.message === "INTEGRATION_ENCRYPTION_UNAVAILABLE" ? "A integração segura ainda não está configurada neste ambiente." : error instanceof Error ? error.message : "Não foi possível conectar à Shopee.";
    return NextResponse.json({ error: message }, { status: message.includes("segura") ? 503 : 400 });
  }
}
