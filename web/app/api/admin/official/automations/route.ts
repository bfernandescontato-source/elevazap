import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { guardInternalAdminMutation, requireInternalAdmin } from "@/lib/internal-admin";
import { automationWriteError, createAutomation, listAutomations, validateAutomationInput } from "@/modules/official-whatsapp/server/automations";
import { automationInputSchema } from "@/modules/official-whatsapp/automation-config";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  try { return NextResponse.json({ automations: await listAutomations() }); }
  catch { return NextResponse.json({ error: "Não foi possível carregar as automações." }, { status: 503 }); }
}
export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_automation_write_ip");
  if (guard) return guard;
  try {
    const input = automationInputSchema.parse(await request.json());
    if (input.followupMode === "legacy") throw new Error("Novas automações devem configurar sua própria segunda mensagem.");
    await validateAutomationInput(input);
    return NextResponse.json({ ok: true, automation: await createAutomation(input) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ZodError ? error.issues.map((issue) => issue.message).join(" ") : automationWriteError(error) }, { status: 400 });
  }
}
