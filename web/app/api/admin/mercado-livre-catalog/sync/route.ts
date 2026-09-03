import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "mercado_livre_catalog_sync_ip"); if (guard) return guard;
  return NextResponse.json({ status: "waiting_for_extension", inserted: 0, updated: 0, message: "Solicitação registrada. Abra o Mercado Livre com a extensão Disparei conectada para atualizar o catálogo." }, { status: 202 });
}
