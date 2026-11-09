import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation, requireInternalAdmin } from "@/lib/internal-admin";
import { ReferralError } from "@/modules/referrals/server/referral-service";
import { listReferralBalances, recordReferralPayout, referralPayoutSchema } from "@/modules/referrals/server/referral-admin";

function failure(error: unknown, fallback: string) {
  if (error instanceof ReferralError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ rows: await listReferralBalances() });
  } catch (error) {
    return failure(error, "Não foi possível carregar as indicações.");
  }
}

// Marca como pago: registra o PIX feito à mão pela dona.
export async function POST(request: NextRequest) {
  const blocked = await guardInternalAdminMutation(request, "internal_admin_referral_payout_ip");
  if (blocked) return blocked;
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const parsed = referralPayoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  try {
    return NextResponse.json(await recordReferralPayout(parsed.data, guard.session.email || "admin"), { status: 201 });
  } catch (error) {
    return failure(error, "Não foi possível registrar o pagamento.");
  }
}
