import { supabaseAdmin } from "@/lib/supabase";
import { officialErrorMessage } from "./errors";
import { logMessageAttempt } from "./messages-store";
import { resolveNextStep, sendFollowupStep } from "./automation-chain";
import type { AutomationSnapshotV2 } from "./automation-followup";

type DueRow = { id: string; phone: string; connection_id: string | null; automation_id: string | null; automation_snapshot: AutomationSnapshotV2 | null };

async function processDueRow(row: DueRow) {
  const admin = supabaseAdmin();
  const snapshot = row.automation_snapshot;
  const step = snapshot?.nextStep;
  if (!snapshot || snapshot.version !== 2 || !step || step.trigger.type !== "delay" || !row.automation_id) {
    await admin.from("official_messages").update({ automation_reply_state: "failed", error: "Etapa por atraso inválida ou automação não encontrada." }).eq("id", row.id);
    return;
  }
  const automationId = row.automation_id;
  // Pausar a automação impede novos disparos por atraso ainda pendentes. Cliques pendentes
  // continuam funcionando (nenhum mecanismo hoje verifica "active" no clique) — mantido de
  // propósito para não mudar esse comportamento existente.
  const { data: automation, error: automationError } = await admin.from("official_automations").select("active").eq("id", automationId).maybeSingle();
  if (automationError) throw automationError;
  if (!automation?.active) {
    await admin.from("official_messages").update({ automation_reply_state: "failed", error: "Automação pausada antes do disparo desta etapa." }).eq("id", row.id);
    return;
  }
  let accepted = false;
  try {
    const nextStep = await resolveNextStep(automationId, step.id);
    const result = await sendFollowupStep({ automationId, connectionId: row.connection_id, phone: row.phone, step, context: snapshot.context, nextStep });
    accepted = true;
    await admin.from("official_messages").update({ automation_reply_state: "sent" }).eq("id", row.id);
    await logMessageAttempt({
      eventId: null, phone: result.phone,
      status: "accepted", metaMessageId: result.messageId, requestPayload: result.requestPayload, responsePayload: result.response, connectionId: result.connectionId,
      automationId, automationSnapshot: { version: 2, automationId, context: snapshot.context, nextStep },
      attribution: { sourceType: "automation", sourceId: automationId, messageKey: `step:${step.id}`, phoneNumberId: result.phoneNumberId }
    });
  } catch (error) {
    // Não reenviar em falha: uma tentativa que já chamou a Meta é uma entrega ambígua, não um erro certo.
    await admin.from("official_messages").update({ automation_reply_state: accepted ? "sent" : "failed", error: accepted ? null : officialErrorMessage(error).slice(0, 500) }).eq("id", row.id);
  }
}

// Chamado pelo cron da Vercel (ver run-due-followups/route.ts) uma vez por minuto. Reivindica as
// etapas por atraso vencidas via claim_due_official_followups (FOR UPDATE SKIP LOCKED) e processa
// cada uma isoladamente, tolerando falha parcial de um item sem afetar os demais do lote.
export async function runDueOfficialFollowups() {
  const admin = supabaseAdmin();
  const { data: claimed, error } = await admin.rpc("claim_due_official_followups", { p_limit: 20, p_stale_seconds: 120 });
  if (error) throw error;
  const ids = (claimed || []).map((row: { id: string }) => row.id);
  if (!ids.length) return { processed: 0 };
  const { data: rows, error: rowsError } = await admin.from("official_messages").select("id,phone,connection_id,automation_id,automation_snapshot").in("id", ids);
  if (rowsError) throw rowsError;
  await Promise.all((rows || []).map((row) => processDueRow(row as DueRow).catch((err) => console.error(`[official-followup] falha ao processar ${row.id}:`, err))));
  return { processed: rows?.length || 0 };
}
