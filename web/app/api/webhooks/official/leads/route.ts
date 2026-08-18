import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit } from "@/lib/security";
import { normalizeBrazilianPhone } from "@/lib/phone";
import { findExternalSourceByKey, externalSecretMatches } from "@/modules/official-whatsapp/server/external-sources";
import { captureExternalLead, markExternalLeadResult, extractLeadFields, resolveContentName, buildLeadContext } from "@/modules/official-whatsapp/server/external-leads";
import { startFlow } from "@/modules/official-whatsapp/server/flow-processor";
import { officialErrorCode, officialErrorMessage } from "@/modules/official-whatsapp/server/errors";

const MAX_BODY_BYTES = 20_000;

// Endpoint público — chamado pelo Google Apps Script depois de gravar o lead na planilha, sem
// polling. Autenticação é o par (origem = source_key, secret hasheado), nunca sessão. O flow_id
// enviado é sempre resolvido a partir da entrada externa configurada no admin — o request nunca
// escolhe o fluxo, então vazar o secret de uma origem não dá acesso a outros fluxos.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, { status: 413 });

  const body = (() => { try { return JSON.parse(rawBody) as Record<string, unknown>; } catch { return null; } })();
  if (!body) return NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });

  const secret = request.headers.get("x-disparei-secret");
  const idempotencyKey = request.headers.get("x-disparei-idempotency-key");
  const { fullName, rawPhone, sourceKey, premio } = extractLeadFields(body);

  if (!secret) return NextResponse.json({ ok: false, code: "MISSING_SECRET" }, { status: 401 });
  if (!idempotencyKey) return NextResponse.json({ ok: false, code: "MISSING_IDEMPOTENCY_KEY" }, { status: 400 });
  if (!sourceKey || !fullName || !rawPhone) return NextResponse.json({ ok: false, code: "MISSING_FIELDS" }, { status: 400 });

  const source = await findExternalSourceByKey(sourceKey);
  if (!source) return NextResponse.json({ ok: false, code: "SOURCE_NOT_FOUND" }, { status: 404 });
  if (!source.active) return NextResponse.json({ ok: false, code: "SOURCE_INACTIVE" }, { status: 403 });
  if (!externalSecretMatches(secret, source.secret_hash)) return NextResponse.json({ ok: false, code: "INVALID_SECRET" }, { status: 401 });

  const allowed = await persistentRateLimit(source.id, "official_external_lead_source", 120, 60);
  if (!allowed) return NextResponse.json({ ok: false, code: "RATE_LIMITED" }, { status: 429 });

  let phone: string;
  try {
    phone = normalizeBrazilianPhone(rawPhone);
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_PHONE" }, { status: 400 });
  }

  const contentName = resolveContentName(source.fixed_content_name, premio);

  const capture = await captureExternalLead({
    sourceId: source.id, idempotencyKey, rawPayload: body, fullName, phone, contentName
  });
  if (capture.duplicate) {
    if (capture.lead?.status === "accepted") {
      return NextResponse.json({ ok: true, duplicate: true, flowRunId: capture.lead.flow_run_id });
    }
    return NextResponse.json({ ok: false, code: "DUPLICATE_NOT_YET_ACCEPTED" }, { status: 409 });
  }

  const context = buildLeadContext(fullName, phone, contentName);

  try {
    const result = await startFlow({ flowId: source.flow_id, rawPhone: phone, context, source: "external", sourceReference: capture.leadId });
    await markExternalLeadResult(capture.leadId, "accepted", result.flowRunId, null);
    return NextResponse.json({ ok: true, flowRunId: result.flowRunId, status: "accepted" });
  } catch (error) {
    const summary = `${officialErrorCode(error)}: ${officialErrorMessage(error)}`.slice(0, 500);
    await markExternalLeadResult(capture.leadId, "failed", null, summary);
    return NextResponse.json({ ok: false, code: officialErrorCode(error) }, { status: 500 });
  }
}
