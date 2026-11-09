"use client";

import { AlertTriangle, Gauge } from "lucide-react";
import type { CapacityMessage } from "@/modules/dispatch-capacity/capacity";

/** Aviso de capacidade do número: amarelo quando a fila vai atrasar, discreto quando está tudo bem. */
export function CapacityNotice({ message, children }: { message: CapacityMessage | null; children?: React.ReactNode }) {
  if (!message) return null;
  if (message.tone === "ok") {
    return <div className="flex gap-2 rounded-lg border border-line bg-wash p-3 text-sm text-muted terra:rounded-xl" role="status">
      <Gauge size={16} className="mt-0.5 shrink-0 text-emerald-700" />
      <div className="min-w-0"><p>{message.lines.join(" ")}</p>{children}</div>
    </div>;
  }
  return <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 terra:rounded-xl" role="alert">
    <div className="flex gap-2">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">{message.title}</p>
        {message.lines.map((line) => <p key={line}>{line}</p>)}
        {children}
      </div>
    </div>
  </div>;
}
