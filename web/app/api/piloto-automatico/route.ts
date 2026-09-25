import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { automationConfigSchema } from "@/modules/offer-autopilot/schemas";
import { loadAutopilot, saveAutopilot } from "@/modules/offer-autopilot/server/service";
import { serverError } from "@/shared/http/responses";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  try { return NextResponse.json(await loadAutopilot(context.database, context.accountId)); }
  catch (error) { return serverError(error, "Não foi possível carregar o Piloto Automático."); }
}

export async function PUT(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const body = await request.json();
  // O aluno só vê a mensagem vermelha na tela; sem este registro, não há como saber
  // depois por que o salvamento falhou (trocas de grupo/número são as queixas comuns).
  const logRejected = (status: number, message: string, extra: Record<string, unknown> = {}) => console.warn({
    event: "pilot_config_save_rejected", account_id: context.accountId, status, message,
    source_groups: Array.isArray(body?.source_group_ids) ? body.source_group_ids.length : null,
    destination_groups: Array.isArray(body?.destination_group_ids) ? body.destination_group_ids.length : null,
    mercado_livre_conversion: body?.mercado_livre_conversion_enabled ?? null, shopee_conversion: body?.shopee_conversion_enabled ?? null,
    ...extra
  });
  const parsed = automationConfigSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "Configuração inválida.";
    logRejected(400, message, { field: parsed.error.issues[0]?.path?.join(".") });
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const { data: account } = await context.database.from("accounts").select("max_source_groups").eq("id", context.accountId).maybeSingle();
  const maxSourceGroups = account?.max_source_groups ?? 2;
  if (parsed.data.source_group_ids.length > maxSourceGroups) {
    const message = `Máximo de ${maxSourceGroups} grupos fonte por automação.`;
    logRejected(400, message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
  try { return NextResponse.json({ automation: await saveAutopilot(context.database, context.accountId, context.session.userId!, parsed.data) }); }
  catch (error) {
    const message = error instanceof Error ? error.message : (error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message) : "Não foi possível salvar o Piloto Automático.");
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    logRejected(500, message, { code });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
