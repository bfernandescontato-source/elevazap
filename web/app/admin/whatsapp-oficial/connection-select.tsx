"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type ConnectionSummary = {
  id: string; label: string; source: "legacy" | "database"; status: string;
  phone_number_id: string; waba_id: string | null; app_id?: string; business_portfolio_id?: string;
  display_phone_number: string | null; verified_name: string | null; waba_name: string | null;
  graph_version: string; quality_rating: string | null; throughput_level: string | null;
  last_tested_at: string | null; last_error: string | null; webhook_verified_at?: string | null; app_subscribed?: boolean;
};

export function ConnectionSelect({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [accounts, setAccounts] = useState<ConnectionSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetch("/api/admin/official/connections", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao carregar contas.");
      if (active) setAccounts(data.connections || []);
    }).catch((reason) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <div className="space-y-2">
    <label className="block text-sm font-medium text-ink">Conta de API oficial
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || loading || Boolean(error)} className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm disabled:opacity-60">
        {loading ? <option value={value}>Carregando contas…</option> : null}
        {!loading && !accounts.some((account) => account.id === value) ? <option value={value}>Selecione uma conta disponível</option> : null}
        {accounts.map((account) => <option key={account.id} value={account.id} disabled={account.status !== "connected"}>{account.label}{account.display_phone_number ? ` · ${account.display_phone_number}` : ""}{account.status !== "connected" ? " (indisponível)" : account.source === "database" && (!account.webhook_verified_at || !account.app_subscribed) ? " (finalizar webhook)" : ""}</option>)}
      </select>
    </label>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="text-xs text-muted">Templates e envios usam a conta selecionada. <Link href="/admin/whatsapp-oficial/contas" className="underline">Gerenciar contas</Link></p>}
  </div>;
}
