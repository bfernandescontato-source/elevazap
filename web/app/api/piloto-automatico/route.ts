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
  const parsed = automationConfigSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Configuração inválida." }, { status: 400 });
  const { data: account } = await context.database.from("accounts").select("max_source_groups").eq("id", context.accountId).maybeSingle();
  const maxSourceGroups = account?.max_source_groups ?? 2;
  if (parsed.data.source_group_ids.length > maxSourceGroups) {
    return NextResponse.json({ error: `Máximo de ${maxSourceGroups} grupos fonte por automação.` }, { status: 400 });
  }
  try { return NextResponse.json({ automation: await saveAutopilot(context.database, context.accountId, context.session.userId!, parsed.data) }); }
  catch (error) {
    const message = error instanceof Error ? error.message : (error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message) : "Não foi possível salvar o Piloto Automático.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
