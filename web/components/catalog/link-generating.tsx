"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/** Caixa de "link sendo gerado": o link do Mercado Livre sai pela extensão e leva até ~30 s. */
export function LinkGenerating({ current, total }: { current?: number; total?: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    const timer = setInterval(() => setSeconds(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [current]);
  return <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
    <Loader2 className="mt-0.5 shrink-0 animate-spin" size={20}/>
    <div className="min-w-0 flex-1">
      <p className="font-semibold">{total && total > 1 ? `Gerando link afiliado ${current} de ${total}...` : "Seu link afiliado está sendo gerado..."}</p>
      <p className="mt-1 text-sm">Aguarde um momento. Cada link do Mercado Livre leva até 30 segundos. Mantenha o Chrome aberto e logado no Mercado Livre.</p>
      <p className="mt-2 text-xs tabular-nums opacity-80">{seconds}s</p>
    </div>
  </div>;
}
