import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { recurringMessageInputSchema, recurringMessageToggleSchema } from "@/modules/recurring-messages/schemas";
import { RecurringMessageError, deleteRecurringMessage, toggleRecurringMessage, updateRecurringMessage } from "@/modules/recurring-messages/server/service";

type Params = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  if (error instanceof RecurringMessageError) return NextResponse.json({ error: error.message }, { status: error.status });
  throw error;
}

async function messageId(params: Params["params"]) {
  const parsed = z.string().uuid().safeParse((await params).id);
  return parsed.success ? parsed.data : null;
}

// Corpo só com { ativo } liga ou desliga; corpo completo salva a edição.
export async function PATCH(request: NextRequest, { params }: Params) {
  const guard = await guardAdminMutation(request, "recurring_messages_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const id = await messageId(params);
  if (!id) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  try {
    if (body && Object.keys(body).length === 1 && "ativo" in body) {
      const toggle = recurringMessageToggleSchema.safeParse(body);
      if (!toggle.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
      return NextResponse.json(await toggleRecurringMessage(context.accountId, id, toggle.data.ativo));
    }
    const parsed = recurringMessageInputSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
    return NextResponse.json(await updateRecurringMessage(context.accountId, id, parsed.data));
  } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const guard = await guardAdminMutation(request, "recurring_messages_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const id = await messageId(params);
  if (!id) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
  try { await deleteRecurringMessage(context.accountId, id); return NextResponse.json({ ok: true }); }
  catch (error) { return failure(error); }
}
