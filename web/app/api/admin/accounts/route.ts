import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation, requireInternalAdmin } from "@/lib/internal-admin";
import {
  AccountProvisioningError,
  adminAccountSchema,
  listProvisionedAccounts,
  provisionAccount,
} from "@/modules/admin/server/account-provisioning";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ accounts: await listProvisionedAccounts() });
  } catch (error) {
    const message = error instanceof AccountProvisioningError ? error.message : "Não foi possível carregar as contas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "internal_admin_create_account_ip");
  if (guard) return guard;
  const parsed = adminAccountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  }
  try {
    const created = await provisionAccount(parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof AccountProvisioningError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Não foi possível criar a conta." }, { status: 500 });
  }
}
