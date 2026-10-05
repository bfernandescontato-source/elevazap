"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, Puzzle, ShoppingBag, Zap } from "lucide-react";
import { AppShell } from "@/components/ui";
import { BulkScheduleDialog } from "@/components/catalog/bulk-schedule-dialog";
import type { AffiliateOffer } from "@/modules/affiliate-catalog/types";

// Produtos do carrinho da extensão (Vitrine). O disparei-bridge entrega pelo
// postMessage; esta página só converte para oferta e usa o agendamento do Catálogo.
type Loja = "ML" | "Amazon" | "Shopee" | "Magalu";
type ProdutoDaExtensao = { itemId: string; platform: Loja; title: string; price?: string; oldPrice?: string; discount?: string; coupon?: string; imageUrl?: string; originalUrl?: string; vendas?: number };
type Estado = "carregando" | "bloqueada" | "sem-extensao" | "pronta";

const PROVIDER: Record<Loja, AffiliateOffer["provider"]> = { ML: "MERCADO_LIVRE", Amazon: "AMAZON", Shopee: "SHOPEE", Magalu: "MAGALU" };
const NOME: Record<AffiliateOffer["provider"], string> = { MERCADO_LIVRE: "Mercado Livre", AMAZON: "Amazon", SHOPEE: "Shopee", MAGALU: "Magalu", TIKTOK_SHOP: "TikTok Shop" };
const offerKey = (offer: AffiliateOffer) => `${offer.provider}:${offer.externalItemId}`;
const money = (value?: number) => value === undefined ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

function reais(value?: string) {
  const match = String(value || "").match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/);
  const parsed = match ? parseFloat(`${match[1].replace(/\./g, "")}.${match[2] || "0"}`) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
const httpsOuNada = (value?: string) => { try { return value && new URL(value).protocol === "https:" ? value : undefined; } catch { return undefined; } };

function paraOferta(produto: ProdutoDaExtensao): { offer: AffiliateOffer; chaveDoCarrinho: string } | null {
  const provider = PROVIDER[produto.platform];
  if (!provider || !produto.itemId || !produto.title) return null;
  const discount = Number(String(produto.discount || "").replace(/\D/g, ""));
  return {
    chaveDoCarrinho: `${produto.platform}:${produto.itemId}`,
    offer: {
      provider, externalItemId: produto.itemId.slice(0, 120), name: produto.title.slice(0, 500),
      imageUrl: httpsOuNada(produto.imageUrl), priceMin: reais(produto.price), originalPrice: reais(produto.oldPrice),
      discountPercentage: discount > 0 && discount <= 100 ? discount : undefined, sales: produto.vendas || undefined,
      productUrl: httpsOuNada(produto.originalUrl)
    }
  };
}

export default function ExtensionCartPage() {
  const [estado, setEstado] = useState<Estado>("carregando");
  const [carrinho, setCarrinho] = useState<ProdutoDaExtensao[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [dialogo, setDialogo] = useState<{ ofertas: AffiliateOffer[]; dia: "now" | "today" } | null>(null);

  const itens = useMemo(() => carrinho.map(paraOferta).filter((item): item is NonNullable<typeof item> => Boolean(item)), [carrinho]);
  const chaveDoCarrinho = useMemo(() => new Map(itens.map(item => [offerKey(item.offer), item.chaveDoCarrinho])), [itens]);
  const escolhidas = itens.filter(item => selecionados.has(offerKey(item.offer))).map(item => item.offer);

  useEffect(() => {
    let cancelado = false;
    const aoReceber = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== "DISPAREI_VITRINE_ENVIO") return;
      window.removeEventListener("message", aoReceber);
      const enviados: ProdutoDaExtensao[] = Array.isArray(event.data.itens) ? event.data.itens : [];
      const todos: ProdutoDaExtensao[] = Array.isArray(event.data.carrinho) ? event.data.carrinho : [];
      // O que veio do botão fica no topo e já marcado; o resto do carrinho aparece abaixo.
      const vistos = new Set(enviados.map(produto => `${produto.platform}:${produto.itemId}`));
      const lista = [...enviados, ...todos.filter(produto => !vistos.has(`${produto.platform}:${produto.itemId}`))];
      setCarrinho(lista);
      const marcados = (enviados.length ? enviados : todos).map(paraOferta).filter(Boolean).map(item => offerKey(item!.offer));
      setSelecionados(new Set(marcados));
      setEstado("pronta");
      const modo = event.data.modo;
      if (enviados.length && (modo === "agora" || modo === "lote")) {
        const ofertas = enviados.map(paraOferta).filter(Boolean).map(item => item!.offer);
        if (ofertas.length) setDialogo({ ofertas, dia: modo === "agora" ? "now" : "today" });
      }
    };
    fetch("/api/extensao/vitrine", { cache: "no-store" }).then(response => response.ok ? response.json() : { liberada: false }).then(body => {
      if (cancelado) return;
      if (!body.liberada) { setEstado("bloqueada"); return; }
      window.addEventListener("message", aoReceber);
      window.postMessage({ type: "DISPAREI_VITRINE_PEDIR_ENVIO" }, window.location.origin);
      setTimeout(() => { if (!cancelado) setEstado(current => current === "carregando" ? "sem-extensao" : current); }, 2500);
    }).catch(() => { if (!cancelado) setEstado("bloqueada"); });
    return () => { cancelado = true; window.removeEventListener("message", aoReceber); };
  }, []);

  const alternar = (key: string) => setSelecionados(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const aoTerminar = (agendadas: string[]) => {
    const chaves = agendadas.map(key => chaveDoCarrinho.get(key)).filter(Boolean);
    if (chaves.length) window.postMessage({ type: "DISPAREI_VITRINE_ENVIADOS", chaves }, window.location.origin);
    const feitas = new Set(agendadas);
    setCarrinho(old => old.filter(produto => { const item = paraOferta(produto); return !item || !feitas.has(offerKey(item.offer)); }));
    setSelecionados(old => new Set([...old].filter(key => !feitas.has(key))));
  };

  return <AppShell title="Carrinho da extensão" subtitle="Produtos que você juntou no Mercado Livre, Amazon, Shopee e Magalu.">
    {estado === "carregando" ? <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="animate-spin" size={16}/> Buscando o carrinho da extensão...</div>
      : estado === "bloqueada" ? <div className="rounded-xl border border-line bg-white p-8 text-center"><Puzzle className="mx-auto text-muted"/><h2 className="mt-3 font-semibold">Recurso ainda não liberado para sua conta.</h2></div>
      : estado === "sem-extensao" ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">Não encontramos a extensão neste navegador. Instale a versão mais nova em <a href="/baixar-extensao" className="font-medium underline">Baixar extensão</a> e recarregue esta página.</div>
      : !itens.length ? <div className="rounded-xl border border-dashed border-line bg-white p-12 text-center"><ShoppingBag className="mx-auto text-muted"/><h2 className="mt-3 font-semibold">Carrinho vazio.</h2><p className="mt-1 text-sm text-muted">Abra uma loja e use os botões &quot;+ Carrinho&quot; nos produtos.</p></div>
      : <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm"><button onClick={() => setSelecionados(new Set(itens.map(item => offerKey(item.offer))))} className="rounded-lg border border-line bg-white px-3 py-2">Selecionar todos ({itens.length})</button>{selecionados.size ? <button onClick={() => setSelecionados(new Set())} className="text-muted underline">Limpar seleção</button> : null}</div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5">{itens.map(({ offer }) => { const key = offerKey(offer); const marcado = selecionados.has(key);
          return <button key={key} type="button" onClick={() => alternar(key)} className={`flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm ${marcado ? "border-primary ring-2 ring-primary" : "border-line"}`}>
            <div className="relative aspect-square bg-wash"><span className="absolute left-2 top-2 z-10 rounded-full bg-black/80 px-2 py-1 text-[10px] font-bold uppercase text-white">{NOME[offer.provider]}</span><input type="checkbox" readOnly checked={marcado} className="absolute bottom-2 left-2 z-10 h-5 w-5 accent-primary"/>{offer.discountPercentage ? <span className="absolute right-2 top-2 z-10 rounded-full bg-black px-2 py-1 text-[10px] font-bold text-white">{offer.discountPercentage}% OFF</span> : null}{offer.imageUrl ? <img src={offer.imageUrl} alt="" className="h-full w-full object-contain"/> : <div className="grid h-full place-items-center text-muted"><ShoppingBag/></div>}</div>
            <div className="p-3"><h2 className="line-clamp-2 min-h-10 text-sm font-medium">{offer.name}</h2>{offer.originalPrice ? <div className="mt-2 text-xs text-muted line-through">{money(offer.originalPrice)}</div> : null}<div className="text-lg font-semibold">{money(offer.priceMin)}</div></div>
          </button>; })}</div>
      </div>}
    {estado === "pronta" && escolhidas.length ? <div data-floating-bar className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-3 shadow-soft lg:bottom-4"><span className="text-sm font-medium">{escolhidas.length} {escolhidas.length === 1 ? "produto selecionado" : "produtos selecionados"}</span><div className="flex gap-2"><button onClick={() => setDialogo({ ofertas: escolhidas, dia: "today" })} className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium"><CalendarClock size={16}/> Enviar ao lote</button><button onClick={() => setDialogo({ ofertas: escolhidas, dia: "now" })} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"><Zap size={16}/> Disparar agora</button></div></div> : null}
    {dialogo ? <BulkScheduleDialog offers={dialogo.ofertas} initialDay={dialogo.dia} onClose={() => setDialogo(null)} onDone={aoTerminar}/> : null}
  </AppShell>;
}
