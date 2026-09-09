import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getShopeeAnalytics, syncShopeeAnalytics } from "@/modules/shopee-analytics/server/service";

export const dynamic = "force-dynamic";
const EXPECTED = "822852b59119fa977bdbd6597cb1062e092889d6a0f9191eb381d81842fa0b2e";
const ACCOUNT_ID = "c1a198ea-3602-4b7a-bca0-109103feb423";

export async function GET(request: NextRequest) {
  const received = createHash("sha256").update(request.headers.get("x-validation-token") || "").digest();
  const expected = Buffer.from(EXPECTED, "hex");
  if (!timingSafeEqual(received, expected)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const from = request.nextUrl.searchParams.get("from") || "2026-09-07";
  const to = request.nextUrl.searchParams.get("to") || from;
  try {
    await syncShopeeAnalytics(ACCOUNT_ID, from, to, true);
    return NextResponse.json(await getShopeeAnalytics(ACCOUNT_ID, from, to, 1, 100, "", "ALL"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "SHOPEE_UNAVAILABLE" }, { status: 502 });
  }
}
