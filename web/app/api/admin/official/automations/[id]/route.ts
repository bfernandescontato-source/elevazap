import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { supabaseAdmin } from "@/lib/supabase";
import { automationInputSchema } from "@/modules/official-whatsapp/automation-config";
import { automationWriteError, updateAutomation, validateAutomationInput } from "@/modules/official-whatsapp/server/automations";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardInternalAdminMutation(request, "official_automation_write_ip");
  if (guard) return guard;
  try {
    const { id } = await params; z.string().uuid().parse(id);
    const body = await request.json();
    if (body && Object.keys(body).length === 1 && typeof body.active === "boolean") {
      return NextResponse.json({ ok: true, automation: await updateAutomation(id, { active: body.active }) });
    }
    const input = automationInputSchema.parse(body);
    const { data: current, error } = await supabaseAdmin().from("official_automations").select("followup_mode").eq("id", id).single();
    if (error) throw error;
    if (input.followupMode === "legacy" && current.followup_mode !== "legacy") throw new Error("Uma automação organizada não pode voltar ao modo antigo.");
    await validateAutomationInput(input);
    const automation = await updateAutomation(id, { name: input.name, event_type: input.eventType, product_id: input.productId, product_name: input.productName, template_name: input.templateName, template_language: input.templateLanguage, connection_id: input.connectionId, variable_mapping: input.variableMapping, followup_mode: input.followupMode, followup_config: input.followupConfig, active: input.active });
    return NextResponse.json({ ok: true, automation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join(" ") : automationWriteError(error) }, { status: 400 });
  }
}
