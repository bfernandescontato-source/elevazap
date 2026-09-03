import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { mercadoLivreCatalogStats } from "@/modules/affiliate-catalog/server/mercado-livre-catalog-service";

export async function GET() {
  const guard = await requireInternalAdmin(); if (guard.error) return guard.error;
  return NextResponse.json(await mercadoLivreCatalogStats());
}
