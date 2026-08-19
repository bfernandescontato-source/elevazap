import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { disconnectIntegration, startMercadoLivreIntegration } from "@/modules/integrations/server/service";

export async function POST(request: NextRequest) { const origin = requireValidOrigin(request); if (origin) return origin; const context = await requireAccountContext(); if (context.error) return context.error; try { return NextResponse.json(await startMercadoLivreIntegration(context.database, context.accountId, context.session.userId!)); } catch { return NextResponse.json({ error: "Não foi possível iniciar a conexão." }, { status: 500 }); } }
export async function DELETE(request: NextRequest) { const origin = requireValidOrigin(request); if (origin) return origin; const context = await requireAccountContext(); if (context.error) return context.error; try { return NextResponse.json(await disconnectIntegration(context.database, context.accountId, "mercado_livre")); } catch { return NextResponse.json({ error: "Não foi possível desconectar." }, { status: 500 }); } }
