import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { getCatalog } from "@/modules/affiliate-catalog/server/service";

export async function GET(request: NextRequest) {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const query = request.nextUrl.searchParams;
  const listing = query.get("listing") || "top";
  if (!["top", "sold", "commission"].includes(listing)) return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
  const provider = (query.get("provider") || "ALL").toUpperCase();
  if (!["ALL", "SHOPEE", "MERCADO_LIVRE"].includes(provider)) return NextResponse.json({ error: "Marketplace inválido." }, { status: 400 });
  const page = Math.max(1, Number(query.get("page") || 1));
  const categoryId = query.get("categoryId")?.slice(0, 80) || undefined;
  const keyword = query.get("keyword")?.trim().slice(0, 100) || undefined;
  try {
    const result = await getCatalog(context.database, context.accountId, { provider: provider as any, listing: listing as any, page, limit: 20, categoryId, keyword });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SHOPEE_UNAVAILABLE";
    const messages: Record<string, string> = {
      SHOPEE_NOT_CONNECTED: "Conecte sua conta Shopee Affiliate no Piloto Automático para acessar o catálogo.",
      SHOPEE_RATE_LIMIT: "A Shopee recebeu muitas consultas. Aguarde um pouco e tente novamente.",
      SHOPEE_AUTH: "A conexão com a Shopee precisa ser atualizada.",
      SHOPEE_INVALID_QUERY: "O catálogo não está disponível para esta conta Shopee.",
      SHOPEE_UNAVAILABLE: "Não foi possível carregar as ofertas da Shopee agora.",
      MERCADO_LIVRE_NOT_CONFIGURED: "O catálogo oficial do Mercado Livre ainda precisa ser conectado pela equipe da Disparei. A Shopee continua disponível em Todos.",
      MERCADO_LIVRE_AUTH: "A autorização da API do Mercado Livre expirou e precisa ser renovada.",
      MERCADO_LIVRE_RATE_LIMIT: "O Mercado Livre recebeu muitas consultas. Aguarde um pouco e tente novamente.",
      MERCADO_LIVRE_UNAVAILABLE: "Não foi possível carregar as ofertas do Mercado Livre agora.",
      MERCADO_LIVRE_REAUTHORIZATION_REQUIRED: "A conexão central do Mercado Livre precisa ser renovada pela equipe da Disparei."
    };
    return NextResponse.json({ error: messages[code] || "Não foi possível carregar o catálogo agora.", code }, { status: ["SHOPEE_NOT_CONNECTED", "MERCADO_LIVRE_NOT_CONFIGURED"].includes(code) ? 409 : 503 });
  }
}
