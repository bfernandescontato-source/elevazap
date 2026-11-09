import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { listResolveSchema } from "@/modules/affiliate-catalog/link-list";
import { isCatalogAgendaEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { resolveListLink } from "@/modules/affiliate-catalog/server/link-list-service";

// Modo Lista: converte poucos links por chamada (a tela manda de 4 em 4) para a
// resposta voltar rápido e o progresso aparecer link por link.
export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_affiliate_link_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isCatalogAgendaEnabled(context.accountId)) return NextResponse.json({ error: "A Lista de links ainda não está liberada para sua conta." }, { status: 403 });
  const parsed = listResolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Links inválidos." }, { status: 400 });
  const items = await Promise.all(parsed.data.links.map(link => resolveListLink(context.database, context.accountId, link)));
  return NextResponse.json({ items });
}
