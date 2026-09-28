import { supabaseAdmin } from "@/lib/supabase";

// Nichos vêm da tabela public.niches (nicho novo = linha nova, sem deploy).
export type Niche = { id: string; label: string; featured: boolean; shopeeCategoryIds: number[]; mlCategoryIds: string[] };

const TTL_MS = 5 * 60_000;
let cache: { expires: number; niches: Niche[] } | null = null;

export async function listNiches(): Promise<Niche[]> {
  if (cache && cache.expires > Date.now()) return cache.niches;
  const { data, error } = await supabaseAdmin().from("niches").select("id,label,featured,shopee_category_ids,ml_category_ids").eq("active", true).order("sort");
  if (error) { if (cache) return cache.niches; throw error; }
  const niches = (data || []).map(row => ({ id: row.id, label: row.label, featured: row.featured, shopeeCategoryIds: (row.shopee_category_ids || []).map(Number), mlCategoryIds: row.ml_category_ids || [] }));
  cache = { expires: Date.now() + TTL_MS, niches };
  return niches;
}

// Aceita o id do nicho ("beleza") ou um código de categoria da Shopee (links antigos).
export async function shopeeCategoryIdsFor(nicheOrCategory: string) {
  if (/^\d+$/.test(nicheOrCategory)) return [Number(nicheOrCategory)];
  return (await listNiches()).find(niche => niche.id === nicheOrCategory)?.shopeeCategoryIds || [];
}
