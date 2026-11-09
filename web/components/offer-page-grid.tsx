"use client";

import { Search, ShoppingBag } from "lucide-react";
import { useMemo, useState } from "react";
import { formatPrice, type PublicOfferItem } from "@/modules/offer-page/public-mapper";

// Cards da vitrine pública (/v/<endereço>) e da prévia no painel. Cores fixas do
// tema terra: a página pública abre para qualquer visitante, sem o tema da conta.

const STORE_TONES: Record<string, string> = {
  SHOPEE: "bg-[#FBEDE6] text-[#9A4A2E]",
  MERCADO_LIVRE: "bg-[#FBF3DC] text-[#7A5B12]",
  AMAZON: "bg-[#ECEFF1] text-[#37474F]",
  MAGALU: "bg-[#E6F1F2] text-[#1F5F66]"
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function OfferPageGrid({ items, preview = false }: { items: PublicOfferItem[]; preview?: boolean }) {
  const [query, setQuery] = useState("");
  const [store, setStore] = useState("");
  const stores = useMemo(() => Array.from(new Map(items.map((item) => [item.store, item.storeLabel])).entries()), [items]);
  const visible = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return items.filter((item) => (!store || item.store === store) && words.every((word) => normalize(item.title).includes(word)));
  }, [items, query, store]);

  if (!items.length) {
    return <div className="rounded-2xl border border-dashed border-[#EADFD1] bg-[#FFFDFC] p-8 text-center text-sm text-[#746D68]">
      <ShoppingBag className="mx-auto mb-2 text-[#2F7F88]" />
      {preview ? "Assim que você enviar ofertas, elas aparecem aqui." : "Ainda não há ofertas por aqui. Volte mais tarde."}
    </div>;
  }

  return <div>
    <div className="sticky top-0 z-10 -mx-4 mb-4 space-y-3 bg-[#FAF5EE]/95 px-4 py-3 backdrop-blur">
      <label className="relative block">
        <span className="sr-only">Buscar oferta</span>
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#746D68]" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Buscar produto"
          className="h-12 w-full rounded-xl border border-[#EADFD1] bg-[#FFFDFC] pl-10 pr-3 text-base text-[#3A332E] outline-none placeholder:text-[#9A918A] focus:border-[#2F7F88] focus:ring-2 focus:ring-[#2F7F88]/20" />
      </label>
      {stores.length > 1 ? <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por loja">
        {[["", "Todas"] as const, ...stores].map(([id, label]) => <button key={id || "all"} type="button" onClick={() => setStore(id)} aria-pressed={store === id}
          className={`h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition ${store === id ? "border-[#2F7F88] bg-[#2F7F88] text-white" : "border-[#EADFD1] bg-[#FFFDFC] text-[#3A332E]"}`}>{label}</button>)}
      </div> : null}
    </div>
    {!visible.length ? <p className="py-10 text-center text-sm text-[#746D68]">Nenhuma oferta encontrada com essa busca.</p> : null}
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {visible.map((item) => <li key={item.id} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#EADFD1] bg-[#FFFDFC] shadow-[0_8px_24px_rgba(58,51,46,0.06)]">
        <div className="relative aspect-square bg-[#F5EDE2]">
          {item.imageUrl
            ? <img src={item.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-contain p-2" />
            : <div className="grid h-full w-full place-items-center text-[#2F7F88]"><ShoppingBag size={36} /></div>}
          {item.discountPercent ? <span className="absolute left-2 top-2 rounded-full bg-[#2F7F88] px-2 py-0.5 text-xs font-bold text-white">{item.discountPercent}% OFF</span> : null}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${STORE_TONES[item.store] || "bg-[#F5EDE2] text-[#3A332E]"}`}>{item.storeLabel}</span>
          <h2 className="line-clamp-3 text-sm font-medium leading-snug text-[#3A332E]">{item.title}</h2>
          <div className="mt-auto pt-1">
            {item.oldPriceCents ? <div className="text-xs text-[#746D68] line-through">{formatPrice(item.oldPriceCents)}</div> : null}
            {item.priceCents ? <div className="text-lg font-bold leading-tight text-[#3A332E]">{formatPrice(item.priceCents)}</div> : null}
          </div>
          <a href={item.link} target="_blank" rel="nofollow sponsored noopener noreferrer"
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2F7F88] px-3 text-sm font-semibold text-white transition hover:bg-[#2E7279]">Comprar</a>
        </div>
      </li>)}
    </ul>
  </div>;
}
