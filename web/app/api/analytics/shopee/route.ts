import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { getShopeeAnalytics, syncShopeeAnalytics } from "@/modules/shopee-analytics/server/service";

export const dynamic = "force-dynamic";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

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
  try { const p = parameters(request); await syncShopeeAnalytics(context.accountId, p.from, p.to); return NextResponse.json(await getShopeeAnalytics(context.accountId, p.from, p.to, p.page, p.pageSize, p.search, p.status)); }
  catch (error) { const code = error instanceof Error ? error.message : "SHOPEE_UNAVAILABLE"; return NextResponse.json({ error: code === "PERIODO_INVALIDO" ? "Selecione um período válido de até 90 dias." : "Não foi possível atualizar os dados da Shopee agora." }, { status: code === "PERIODO_INVALIDO" ? 400 : 502 }); }
}

export async function POST(request: NextRequest) {
  const context = await requireAccountContext(); if (context.error) return context.error;
  const origin = requireValidOrigin(request); if (origin) return origin;
  try { const p = parameters(request); await syncShopeeAnalytics(context.accountId, p.from, p.to, true); return NextResponse.json(await getShopeeAnalytics(context.accountId, p.from, p.to, p.page, p.pageSize, p.search, p.status)); }
  catch { return NextResponse.json({ error: "Não foi possível sincronizar com a Shopee agora." }, { status: 502 }); }
}
