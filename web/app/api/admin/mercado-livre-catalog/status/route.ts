import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { readMercadoLivreStatus } from "@/modules/affiliate-catalog/server/mercado-livre-token-manager";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const row = await readMercadoLivreStatus();
  return NextResponse.json({
    status: row.status,
    connectedByEmail: row.connected_by_email,
    connectedAt: row.connected_at,
    lastRefreshedAt: row.last_refreshed_at,
    accessTokenExpiresAt: row.access_token_expires_at,
    lastError: row.last_error
  });
}
