import { NextRequest, NextResponse } from "next/server";
import { DISCOUNT_HOOKS, GENERAL_HOOKS } from "@disparei/affiliate-links/offer-copy";
import { MAX_HOOKS_PER_ACCOUNT } from "@disparei/affiliate-links/offer-hooks";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { createHookSchema, deleteHookSchema, hookSettingsSchema, updateHookSchema } from "@/modules/offer-hooks/schemas";
import { HookSettingsError, addHook, deleteHook, getHookConfig, hookAiConfigured, moveHook, saveHookSettings, updateHookText } from "@/modules/offer-hooks/server/hook-settings-service";

const failure = (error: unknown) => {
  if (error instanceof HookSettingsError) return NextResponse.json({ error: error.message }, { status: error.status });
  throw error;
};
const invalid = (issues: { message: string }[]) => NextResponse.json({ error: issues[0]?.message || "Dados inválidos." }, { status: 400 });

// Ganchos da conta (Catálogo e Piloto): lista própria, modo e ganchos do sistema para consulta.
export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  try {
    const config = await getHookConfig(context.accountId);
    return NextResponse.json({ ...config, maxHooks: MAX_HOOKS_PER_ACCOUNT, aiAvailable: hookAiConfigured(), systemHooks: { general: GENERAL_HOOKS, discount: DISCOUNT_HOOKS } });
  } catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest) {
  const guard = await guardAdminMutation(request, "offer_hooks_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = hookSettingsSchema.safeParse(await request.json());
  if (!parsed.success) return invalid(parsed.error.issues);
  try { await saveHookSettings(context.accountId, parsed.data); return NextResponse.json({ ok: true }); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "offer_hooks_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = createHookSchema.safeParse(await request.json());
  if (!parsed.success) return invalid(parsed.error.issues);
  try { return NextResponse.json({ hook: await addHook(context.accountId, parsed.data.text) }); }
  catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest) {
  const guard = await guardAdminMutation(request, "offer_hooks_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = updateHookSchema.safeParse(await request.json());
  if (!parsed.success) return invalid(parsed.error.issues);
  try {
    if ("move" in parsed.data) await moveHook(context.accountId, parsed.data.id, parsed.data.move);
    else await updateHookText(context.accountId, parsed.data.id, parsed.data.text);
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest) {
  const guard = await guardAdminMutation(request, "offer_hooks_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = deleteHookSchema.safeParse(await request.json());
  if (!parsed.success) return invalid(parsed.error.issues);
  try { await deleteHook(context.accountId, parsed.data.id); return NextResponse.json({ ok: true }); }
  catch (error) { return failure(error); }
}
