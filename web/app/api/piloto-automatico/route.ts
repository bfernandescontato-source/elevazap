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
  const parsed = automationConfigSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Configuração inválida." }, { status: 400 });
  try { return NextResponse.json({ automation: await saveAutopilot(context.database, context.accountId, context.session.userId!, parsed.data) }); }
  catch (error) {
    const message = error instanceof Error ? error.message : (error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message) : "Não foi possível salvar o Piloto Automático.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
