import { supabaseAdmin } from "@/lib/supabase";
import type { EventContext } from "./variable-resolver";

export type ExternalLeadStatus = "pending" | "accepted" | "failed";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type LeadPayloadFields = { fullName: string | null; rawPhone: string | null; sourceKey: string | null; premio: string | null };

// Pura, sem I/O — extrai e normaliza (trim) os campos que o request público envia. Não valida
// telefone (isso é normalizeBrazilianPhone, já testado em outro lugar) nem resolve content_name
// (depende da entrada externa configurada, que só é conhecida depois de achar a source).
export function extractLeadFields(body: Record<string, unknown> | null): LeadPayloadFields {
  return { fullName: str(body?.nome), rawPhone: str(body?.telefone), sourceKey: str(body?.origem), premio: str(body?.premio) };
}

// Requisito: se a entrada externa tem um valor fixo configurado, ele sempre vence — permite
// trocar o texto sem editar o site da roleta. Sem valor fixo, cai pro "premio" do payload.
export function resolveContentName(fixedContentName: string | null, premio: string | null): string | null {
  return fixedContentName || premio;
}

// Mapeia os nomes crus do lead pro EventContext compartilhado com o resto do módulo (Hubla,
// disparo em massa) — nenhum fluxo precisa saber que esse contato veio de fora.
export function buildLeadContext(fullName: string, phone: string, contentName: string | null): EventContext {
  return { customerName: fullName, productName: contentName, customerEmail: null, customerPhone: phone, amountCents: null, paymentUrl: null, accessUrl: null };
}

// Mesmo padrão de captureHublaEvent: tenta inserir, e se a unique constraint (source_id,
// idempotency_key) rejeitar, é retry/duplo-submit da mesma origem. Em vez de só devolver a
// linha antiga (o que faria um retry legítimo de uma falha transitória nunca reprocessar),
// incrementa duplicate_attempts e devolve o status real da tentativa original — o chamador
// decide a resposta: "accepted" existente é reenvio confirmado, "pending"/"failed" não é.
export async function captureExternalLead(input: {
  sourceId: string;
  idempotencyKey: string;
  rawPayload: unknown;
  fullName: string | null;
  phone: string | null;
  contentName: string | null;
}) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_external_leads").insert({
    source_id: input.sourceId,
    idempotency_key: input.idempotencyKey,
    raw_payload: input.rawPayload,
    full_name: input.fullName,
    phone: input.phone,
    content_name: input.contentName,
    status: "pending"
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      const { data: existing, error: findError } = await admin.from("official_external_leads")
        .select("id,status,flow_run_id,duplicate_attempts").eq("source_id", input.sourceId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
      if (findError) throw findError;
      if (existing) {
        await admin.from("official_external_leads").update({ duplicate_attempts: existing.duplicate_attempts + 1 }).eq("id", existing.id);
      }
      return { duplicate: true as const, lead: existing as { id: string; status: ExternalLeadStatus; flow_run_id: string | null } | null };
    }
    throw error;
  }
  return { duplicate: false as const, leadId: data.id as string };
}

export async function markExternalLeadResult(id: string, status: ExternalLeadStatus, flowRunId: string | null, error: string | null) {
  const admin = supabaseAdmin();
  const { error: dbError } = await admin.from("official_external_leads").update({ status, flow_run_id: flowRunId, error }).eq("id", id);
  if (dbError) throw dbError;
}

export async function listExternalLeads(sourceId: string, statusFilter?: string, limit = 200) {
  const admin = supabaseAdmin();
  let query = admin.from("official_external_leads").select("*").eq("source_id", sourceId).order("created_at", { ascending: false }).limit(limit);
  if (statusFilter && statusFilter !== "all") query = query.eq("status", statusFilter);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
