import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { disconnectMercadoLivre } from "@/modules/affiliate-catalog/server/mercado-livre-token-manager";

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "mercado_livre_disconnect_ip");
  if (guard) return guard;
  await disconnectMercadoLivre();
  return NextResponse.json({ status: "disconnected" });
}
