import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { getCatalog } from "@/modules/affiliate-catalog/server/service";
import { catalogCategories } from "@/modules/affiliate-catalog/categories";

export async function GET(request: NextRequest) {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const query = request.nextUrl.searchParams;
  const listing = query.get("listing") || "top";
  if (!["top", "sold", "commission"].includes(listing)) return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
  const page = Math.max(1, Number(query.get("page") || 1));
  const categoryId = query.get("categoryId") ? Number(query.get("categoryId")) : undefined;
  const keyword = query.get("keyword")?.trim().slice(0, 100) || undefined;
  try {
    const result = await getCatalog(context.database, context.accountId, { listing: listing as any, page, limit: 20, categoryId, keyword });
    return NextResponse.json({ ...result, categories: catalogCategories });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SHOPEE_UNAVAILABLE";
    const messages: Record<string, string> = {
      SHOPEE_NOT_CONNECTED: "Conecte sua conta Shopee Affiliate no Piloto Automático para acessar o catálogo.",
      SHOPEE_RATE_LIMIT: "A Shopee recebeu muitas consultas. Aguarde um pouco e tente novamente.",
      SHOPEE_AUTH: "A conexão com a Shopee precisa ser atualizada.",
      SHOPEE_INVALID_QUERY: "O catálogo não está disponível para esta conta Shopee.",
      SHOPEE_UNAVAILABLE: "Não foi possível carregar as ofertas da Shopee agora."
    };
    return NextResponse.json({ error: messages[code] || messages.SHOPEE_UNAVAILABLE, code }, { status: code === "SHOPEE_NOT_CONNECTED" ? 409 : 503 });
  }
}
