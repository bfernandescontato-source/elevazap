// Filtros compartilhados pelos catálogos guardados no banco (Mercado Livre,
// Amazon e Magalu): busca por texto, produtos recentes e nicho -> categorias.

/** Produto do ML que a extensão não vê há mais que isso some do catálogo
 *  (o preço/oferta provavelmente mudou). Os dados continuam no banco. */
export const MERCADO_LIVRE_RECENT_DAYS = 7;

export function recentSince(days: number, now = Date.now()) {
  return new Date(now - days * 86_400_000).toISOString();
}

/** Texto digitado pela pessoa, limpo para entrar num filtro do PostgREST. */
export function cleanKeyword(keyword: string | undefined) {
  return (keyword || "").replace(/[%_,()"*\\:]/g, " ").replace(/\s+/g, " ").trim();
}

/** Filtro `or` do PostgREST: o texto aparece no nome OU na categoria. */
export function keywordOrFilter(keyword: string | undefined, nameColumn: string, categoryColumn = "category") {
  const text = cleanKeyword(keyword);
  if (!text) return null;
  return `${nameColumn}.ilike."%${text}%",${categoryColumn}.ilike."%${text}%"`;
}

/** Lista categorias distintas lendo só a coluna category, em páginas, sem o
 *  corte de 1000 linhas (que trazia só as primeiras ~5 categorias). */
export async function distinctCategories(
  loadPage: (from: number, to: number) => Promise<Array<{ category: string | null }>>,
  pageSize = 1000,
  maxPages = 20
) {
  const found = new Set<string>();
  for (let index = 0; index < maxPages; index++) {
    const from = index * pageSize;
    const rows = await loadPage(from, from + pageSize - 1);
    for (const row of rows) if (row.category) found.add(row.category);
    if (rows.length < pageSize) break;
  }
  return [...found].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// Nichos da vitrine ("Todos") -> categorias usadas por ML, Amazon e Magalu.
// Subnicho sem entrada própria usa a do nicho pai (ex.: maquiagem -> beleza).
const MODA = ["Calçados, Roupas e Bolsas", "Moda"];
const NICHE_STORE_CATEGORIES: Record<string, string[]> = {
  "moda-feminina": MODA, "moda-masculina": MODA, "moda-infantil": MODA, bolsas: MODA, calcados: MODA, acessorios: MODA,
  beleza: ["Beleza e Cuidado Pessoal", "Beleza"],
  casa: ["Casa, Móveis e Decoração", "Casa e Decoração", "Casa e Cozinha"],
  cozinha: ["Casa e Cozinha", "Casa, Móveis e Decoração"],
  ferramentas: ["Ferramentas", "Construção"],
  eletronicos: ["Eletrônicos, Áudio e Vídeo", "Eletrônicos", "Celulares e Telefones", "Celulares", "Informática", "Games", "Câmeras e Acessórios"],
  celulares: ["Celulares e Telefones", "Celulares"],
  audio: ["Eletrônicos, Áudio e Vídeo", "Eletrônicos"],
  informatica: ["Informática"],
  games: ["Games"],
  cameras: ["Câmeras e Acessórios"],
  eletrodomesticos: ["Eletrodomésticos"],
  saude: ["Saúde"],
  pet: ["Pet Shop"],
  esportes: ["Esportes e Fitness", "Esportes"],
  bebe: ["Bebês"],
  brinquedos: ["Brinquedos e Hobbies", "Brinquedos"],
  automotivo: ["Acessórios para Veículos", "Automotivo"],
  motos: ["Acessórios para Veículos", "Automotivo"],
  relogios: ["Joias e Relógios"],
  joias: ["Joias e Relógios"],
  mercado: ["Alimentos e Bebidas"],
  papelaria: ["Arte, Papelaria e Armarinho", "Festas e Lembrancinhas"],
  livros: ["Livros, Revistas e Comics", "Livros"],
  hobbies: ["Brinquedos e Hobbies", "Antiguidades e Coleções", "Instrumentos Musicais"]
};

/** Categorias das lojas guardadas para um nicho. Lista vazia = nicho sem
 *  equivalente (a loja fica de fora para não mostrar produto de outro assunto). */
export function nicheStoreCategories(nicheId: string, niches: Array<{ id: string; parentId?: string | null }> = []) {
  if (NICHE_STORE_CATEGORIES[nicheId]) return NICHE_STORE_CATEGORIES[nicheId];
  const parent = niches.find(niche => niche.id === nicheId)?.parentId;
  return parent && NICHE_STORE_CATEGORIES[parent] ? NICHE_STORE_CATEGORIES[parent] : [];
}
