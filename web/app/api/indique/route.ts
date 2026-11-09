import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantDatabase } from "@/lib/tenant-database";
import { requireValidOrigin } from "@/lib/security";
import { getReferralOverview, ReferralError, updatePixKey } from "@/modules/referrals/server/referral-service";

const pixSchema = z.object({
  pixKey: z.string().trim().max(140, "A chave PIX deve ter no máximo 140 caracteres.").nullable(),
});

function failure(error: unknown, fallback: string) {
  if (error instanceof ReferralError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET() {
  const context = await requireTenantDatabase();
  if (context.error) return context.error;
  try {
    return NextResponse.json(await getReferralOverview(context.database, context.accountId, context.account?.name));
  } catch (error) {
    return failure(error, "Não foi possível carregar sua indicação.");
  }
}

export async function PUT(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireTenantDatabase();
  if (context.error) return context.error;
  const parsed = pixSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  try {
    await updatePixKey(context.database, context.accountId, parsed.data.pixKey || null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, "Não foi possível salvar a chave PIX.");
  }
}
