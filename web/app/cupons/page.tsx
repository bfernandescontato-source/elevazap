"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/ui";
import { Check, Clipboard, ExternalLink, Loader2, Ticket } from "lucide-react";

type Coupon = { promotionId: string; code: string; boldText: string; lightText: string; iconText: string; labels: string[]; redirectUrl: string; collectionId: string | null; endTime: number | null; percentageUsed: number | null };

function validade(endTime: number | null) {
  if (!endTime) return "";
  const dias = Math.round((endTime * 1000 - Date.now()) / 86_400_000);
  if (dias <= 0) return "acaba hoje";
  if (dias === 1) return "acaba amanhã";
  return `acaba em ${dias} dias`;
}

export default function CuponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [estado, setEstado] = useState<"carregando" | "ok" | "bloqueado" | "erro">("carregando");
  const [copiado, setCopiado] = useState<string | null>(null);
  const [colecao, setColecao] = useState<string>("todas");

  useEffect(() => {
    fetch("/api/cupons", { cache: "no-store" }).then(async r => {
      if (r.status === 403) { setEstado("bloqueado"); return; }
      if (!r.ok) { setEstado("erro"); return; }
      const body = await r.json(); setCoupons(body.coupons || []); setEstado("ok");
    }).catch(() => setEstado("erro"));
  }, []);

  const colecoes = useMemo(() => Array.from(new Set(coupons.map(c => c.iconText).filter(Boolean))), [coupons]);
  const visiveis = colecao === "todas" ? coupons : coupons.filter(c => c.iconText === colecao);

  const copiar = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setCopiado(code); setTimeout(() => setCopiado(c => c === code ? null : c), 2000); } catch { /* sem clipboard */ }
  };

  return <AppShell title="Cupons Shopee" subtitle="Cupons do dia da Shopee, atualizados automaticamente. Copie o código ou abra direto na Shopee.">
    {estado === "carregando" ? <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="animate-spin" size={16}/> Carregando cupons...</div>
      : estado === "bloqueado" ? <div className="rounded-xl border border-line bg-white p-8 text-center"><Ticket className="mx-auto text-muted"/><h2 className="mt-3 font-semibold">Área de cupons ainda não liberada para sua conta.</h2></div>
      : estado === "erro" ? <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">Não foi possível carregar os cupons agora.</div>
      : !coupons.length ? <div className="rounded-xl border border-dashed border-line bg-white p-12 text-center"><Ticket className="mx-auto text-muted"/><h2 className="mt-3 font-semibold">Nenhum cupom no momento.</h2><p className="mt-1 text-sm text-muted">Os cupons são atualizados pela extensão na coleta do dia.</p></div>
      : <div className="space-y-4">
        {colecoes.length > 1 ? <div className="flex gap-2 overflow-x-auto pb-1">{["todas", ...colecoes].map(c => <button key={c} onClick={() => setColecao(c)} className={`shrink-0 rounded-full border px-4 py-2 text-sm ${colecao === c ? "border-primary bg-primary text-white" : "border-line bg-white text-muted"}`}>{c === "todas" ? "Todos" : c}</button>)}</div> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{visiveis.map(c => <article key={c.promotionId} className="flex flex-col justify-between rounded-xl border border-line bg-white p-4 shadow-sm">
          <div>
            <div className="flex items-center gap-2"><span className="rounded-full bg-[#ee4d2d] px-2 py-0.5 text-[10px] font-bold uppercase text-white">{c.iconText || "Cupom"}</span>{c.labels.slice(0, 1).map(l => <span key={l} className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-medium text-muted">{l}</span>)}</div>
            <h2 className="mt-2 text-lg font-bold text-ink">{c.boldText}</h2>
            <p className="text-sm text-muted">{c.lightText}</p>
            <p className="mt-2 text-xs text-muted">{validade(c.endTime)}{c.percentageUsed != null && c.percentageUsed >= 80 ? ` · ${c.percentageUsed}% usado` : ""}</p>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => copiar(c.code)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white">{copiado === c.code ? <><Check size={15}/> Copiado</> : <><Clipboard size={15}/> Copiar código</>}</button>
            {c.redirectUrl ? <a href={c.redirectUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1 rounded-lg border border-line px-3 py-2 text-sm font-medium"><ExternalLink size={15}/> Shopee</a> : null}
          </div>
        </article>)}</div>
      </div>}
  </AppShell>;
}
