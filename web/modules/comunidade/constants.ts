import type { CommunityCategory } from "./types";

export const CATEGORY_LABELS: Record<CommunityCategory, string> = {
  resultado: "💰 Resultados",
  oferta: "🔥 Ofertas",
  trafego: "📈 Tráfego",
  automacao: "🤖 Automação",
  duvida: "❓ Dúvidas",
  estrategia: "🧠 Estratégias",
  aviso: "📢 Avisos",
  geral: "💬 Geral"
};

export const CATEGORY_STYLES: Record<CommunityCategory, string> = {
  resultado: "bg-emerald-50 text-emerald-700 border-emerald-200",
  oferta: "bg-orange-50 text-orange-700 border-orange-200",
  trafego: "bg-blue-50 text-blue-700 border-blue-200",
  automacao: "bg-indigo-50 text-indigo-700 border-indigo-200",
  duvida: "bg-amber-50 text-amber-700 border-amber-200",
  estrategia: "bg-purple-50 text-purple-700 border-purple-200",
  aviso: "bg-red-50 text-red-700 border-red-200",
  geral: "bg-zinc-50 text-zinc-700 border-zinc-200"
};

export const REPORT_REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  conteudo_impropriado: "Conteúdo impróprio",
  golpe: "Golpe",
  informacao_enganosa: "Informação enganosa",
  outro: "Outro"
};

export const MARKETPLACE_LABELS: Record<string, string> = {
  shopee: "Shopee",
  mercado_livre: "Mercado Livre",
  amazon: "Amazon",
  tiktok_shop: "TikTok Shop",
  outro: "Outro"
};

export function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
