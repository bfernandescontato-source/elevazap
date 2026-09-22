import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { getShopeeAnalytics, syncShopeeAnalytics } from "@/modules/shopee-analytics/server/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function errorCode(error: unknown) {
  const candidate = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,50}$/.test(candidate) ? candidate : "SHOPEE_SYNC_FAILURE";
}

function syncErrorResponse(error: unknown, stage: "sync" | "read") {
  const code = errorCode(error);
  console.error({ event: "shopee_analytics_failed", stage, code, error_type: error instanceof Error ? error.name : "unknown" });
  return NextResponse.json({ error: `Não foi possível sincronizar com a Shopee agora. Código: ${code}.` }, { status: 502 });
}

function parameters(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from") || "";
  const to = request.nextUrl.searchParams.get("to") || "";
  if (!datePattern.test(from) || !datePattern.test(to)) throw new Error("PERIODO_INVALIDO");
  const days = Math.floor((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000) + 1;
  if (days < 1 || days > 90) throw new Error("PERIODO_INVALIDO");
  return { from, to, page: Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1)), pageSize: [20,50,100].includes(Number(request.nextUrl.searchParams.get("pageSize"))) ? Number(request.nextUrl.searchParams.get("pageSize")) : 20, search: (request.nextUrl.searchParams.get("search") || "").slice(0,100), status: (request.nextUrl.searchParams.get("status") || "ALL").slice(0,40) };
}

export async function GET(request: NextRequest) {
  const context = await requireAccountContext(); if (context.error) return context.error;
  let stage: "sync" | "read" = "sync";
  try { const p = parameters(request); await syncShopeeAnalytics(context.accountId, p.from, p.to); stage = "read"; return NextResponse.json(await getShopeeAnalytics(context.accountId, p.from, p.to, p.page, p.pageSize, p.search, p.status)); }
  catch (error) { if (errorCode(error) === "PERIODO_INVALIDO") return NextResponse.json({ error: "Selecione um período válido de até 90 dias." }, { status: 400 }); return syncErrorResponse(error, stage); }
}

export async function POST(request: NextRequest) {
  const context = await requireAccountContext(); if (context.error) return context.error;
  const origin = requireValidOrigin(request); if (origin) return origin;
  let stage: "sync" | "read" = "sync";
  try { const p = parameters(request); await syncShopeeAnalytics(context.accountId, p.from, p.to, true); stage = "read"; return NextResponse.json(await getShopeeAnalytics(context.accountId, p.from, p.to, p.page, p.pageSize, p.search, p.status)); }
  catch (error) { if (errorCode(error) === "PERIODO_INVALIDO") return NextResponse.json({ error: "Selecione um período válido de até 90 dias." }, { status: 400 }); return syncErrorResponse(error, stage); }
}
