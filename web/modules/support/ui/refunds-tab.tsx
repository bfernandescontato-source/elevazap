"use client";

import { ActionButton, AlertCard, ConnectionStatusCard, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { BookOpen, Bot, Check, ChevronRight, DollarSign, Inbox, MessageSquare, Pause, Play, Plus, QrCode, RefreshCw, Send, Trash2, User, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { fmt, statusColor, statusLabel, type Agent, type Conversation, type KBEntry, type Message, type RefundRequest } from "./support-domain";

export function RefundsTab({ notify }: { notify: (m: string) => void }) {
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/support/refunds");
    if (res.ok) { const d = await res.json(); setRefunds(d.refunds || []); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "approve" | "reject") {
    setActing(id);
    try {
      const res = await fetch(`/api/support/refunds/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Falha.");
      notify(action === "approve" ? "Reembolso aprovado e processado." : "Reembolso rejeitado.");
      load();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setActing(null);
    }
  }

  if (loading) return <LoadingState />;

  const refundStatusColor: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    processed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-red-50 text-red-700 border-red-200"
  };

  return (
    <div className="space-y-4">
      {refunds.length === 0 ? (
        <EmptyState title="Sem solicitações de reembolso" description="Quando a IA abrir uma solicitação, ela aparecerá aqui para aprovação." />
      ) : (
        refunds.map((r) => (
          <div key={r.id} className="rounded-lg border border-line bg-panel p-4 shadow-soft">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{r.customer_name || r.support_conversation?.contact_name || r.contact_jid || "—"}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${refundStatusColor[r.status] || "bg-zinc-100 text-zinc-700 border-zinc-200"}`}>
                    {r.status}
                  </span>
                </div>
                <div className="mt-1 text-sm text-muted">
                  E-mail: <span className="font-mono">{r.customer_email || "—"}</span>
                </div>
                <div className="mt-1 text-sm text-muted">
                  Pedido: <span className="font-mono">{r.elevapay_order_id || "—"}</span>
                  {r.amount != null && <span> · R$ {Number(r.amount).toFixed(2).replace(".", ",")}</span>}
                </div>
                <div className="mt-1 text-sm text-ink">{r.reason}</div>
                <div className="mt-1 text-xs text-muted">{fmt(r.created_at)}</div>
              </div>
              {r.status === "pending" && (
                <div className="flex shrink-0 gap-2">
                  <ActionButton
                    icon={<Check size={15} />}
                    onClick={() => act(r.id, "approve")}
                    disabled={acting === r.id}
                    className="bg-emerald-600 text-white"
                  >
                    Aprovar
                  </ActionButton>
                  <ActionButton
                    icon={<X size={15} />}
                    onClick={() => act(r.id, "reject")}
                    disabled={acting === r.id}
                    className="border border-line bg-panel text-red-600"
                  >
                    Rejeitar
                  </ActionButton>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
