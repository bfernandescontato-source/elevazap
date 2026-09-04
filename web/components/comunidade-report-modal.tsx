"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { REPORT_REASON_LABELS } from "@/modules/comunidade/constants";

export function ComunidadeReportModal({ postId, onClose, onDone }: { postId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/comunidade/${postId}/report`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, details: details.trim() || undefined })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      onDone("Denúncia enviada. Nossa equipe vai revisar.");
      onClose();
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível enviar a denúncia.");
    } finally { setLoading(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-end bg-black/45 sm:grid sm:place-items-center sm:p-4">
    <div role="dialog" aria-modal="true" className="app-safe-bottom max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-panel p-5 shadow-soft sm:rounded-xl">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ink">Denunciar publicação</h3>
        <button type="button" aria-label="Fechar" onClick={onClose} className="touch-target grid place-items-center rounded-lg text-muted hover:bg-wash"><X size={18} /></button>
      </div>
      <div className="mt-4 space-y-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">Motivo</label>
          <select value={reason} onChange={(event) => setReason(event.target.value)} className="focus-ring mt-1 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm">
            {Object.entries(REPORT_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">Detalhes (opcional)</label>
          <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={2000} rows={3} className="focus-ring mt-1 w-full resize-none rounded-lg border border-line bg-white p-3 text-sm" />
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button type="button" disabled={loading} className="rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50" onClick={onClose}>Cancelar</button>
        <button type="button" disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50" onClick={submit}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : null} Denunciar
        </button>
      </div>
    </div>
  </div>;
}
