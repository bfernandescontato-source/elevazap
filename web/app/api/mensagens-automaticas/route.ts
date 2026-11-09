import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { recurringMessageInputSchema } from "@/modules/recurring-messages/schemas";
import { RecurringMessageError, createRecurringMessage, listRecurringMessages, listUpcomingRuns } from "@/modules/recurring-messages/server/service";

function failure(error: unknown) {
  if (error instanceof RecurringMessageError) return NextResponse.json({ error: error.message }, { status: error.status });
  throw error;
}

export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  try {
    const [messages, runs] = await Promise.all([listRecurringMessages(context.accountId), listUpcomingRuns(context.accountId)]);
    return NextResponse.json({ messages, runs });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "recurring_messages_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = recurringMessageInputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  try { return NextResponse.json(await createRecurringMessage(context.accountId, parsed.data)); }
  catch (error) { return failure(error); }
}
