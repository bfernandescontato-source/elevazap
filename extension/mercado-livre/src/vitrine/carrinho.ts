import { CARRINHO_KEY, CARRINHO_MAXIMO } from "../shared.js";
import type { Produto } from "./lojas.js";

export const chaveDo = (produto: Pick<Produto, "platform" | "itemId">) => `${produto.platform}:${produto.itemId}`;

export async function lerCarrinho(): Promise<Produto[]> {
  try { const value = (await chrome.storage.local.get(CARRINHO_KEY))[CARRINHO_KEY]; return Array.isArray(value) ? value : []; }
  catch { return []; } // extensão recarregada: o content script antigo perde o acesso
}

async function gravar(itens: Produto[]) { await chrome.storage.local.set({ [CARRINHO_KEY]: itens.slice(0, CARRINHO_MAXIMO) }); }

/** Adiciona sem repetir; o mais novo fica em cima. Devolve quantos entraram de fato. */
export async function adicionar(produtos: Produto[]) {
  const atual = await lerCarrinho();
  const existentes = new Set(atual.map(chaveDo));
  const novos = produtos.filter(produto => produto.itemId && produto.title && !existentes.has(chaveDo(produto))).map(produto => ({ ...produto, addedAt: new Date().toISOString() }));
  const vagas = Math.max(0, CARRINHO_MAXIMO - atual.length);
  await gravar([...novos.slice(0, vagas), ...atual]);
  return { adicionados: Math.min(novos.length, vagas), cheio: novos.length > vagas };
}

export async function remover(chave: string) { await gravar((await lerCarrinho()).filter(produto => chaveDo(produto) !== chave)); }
export async function limpar() { await gravar([]); }

export function aoMudar(callback: (itens: Produto[]) => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[CARRINHO_KEY]) callback(Array.isArray(changes[CARRINHO_KEY].newValue) ? changes[CARRINHO_KEY].newValue : []);
  });
}
