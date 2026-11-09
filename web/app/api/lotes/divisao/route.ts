import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { validateGroupJid } from "@/lib/phone";
import { planSenderSplit } from "@/modules/dispatch-capacity/server/split-service";
import { serverError } from "@/shared/http/responses";

const schema = z.object({
  whatsapp_sender_id: z.string().uuid(),
  group_jids: z.array(z.string()).min(1).max(500)
});

// Prévia de "Dividir os grupos entre meus números": quantos grupos cada número
// receberia. Só leitura; a conta vem da sessão.
export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request); if (origin) return origin;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  try {
    const plan = await planSenderSplit(context.accountId, parsed.data.whatsapp_sender_id, parsed.data.group_jids.filter(validateGroupJid));
    return NextResponse.json({
      senders_used: plan.sendersUsed,
      largest_share: plan.largestShare,
      shares: plan.shares.map((share) => ({ sender_id: share.senderId, label: plan.senders.get(share.senderId)?.label || "Número", groups: share.groups }))
    });
  } catch (error) { return serverError(error, "Não foi possível calcular a divisão entre os números."); }
}
