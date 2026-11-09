"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Gift, RefreshCw } from "lucide-react";
import { AppShell, ConfirmModal, CopyButton, DataTable, EmptyState, ErrorState, LoadingState, StatCard, Toast } from "@/components/ui";
import { formatBRL } from "@/modules/referrals/rules";

type Row = {
  accountId: string;
  accountName: string;
  ownerEmail: string | null;
  code: string | null;
  pixKey: string | null;
  payingCount: number;
  earnedCents: number;
  paidOutCents: number;
  balanceCents: number;
  lastPaidAt: string | null;
};

export default function AdminIndicacoesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  const [paying, setPaying] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/indicacoes", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar as indicações.");
      setRows(body.rows || []);
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível carregar as indicações.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toPay = useMemo(() => rows.filter((row) => row.balanceCents > 0), [rows]);
  const visible = showAll ? rows : toPay;
  const totalToPay = toPay.reduce((sum, row) => sum + row.balanceCents, 0);

  async function markPaid() {
    if (!selected) return;
    setPaying(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/indicacoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: selected.accountId, amountCents: selected.balanceCents, note: note.trim() || null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível registrar o pagamento.");
      setNotice(`Pagamento de ${formatBRL(selected.balanceCents)} registrado.`);
      setSelected(null); setNote("");
      await load();
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível registrar o pagamento.");
    } finally { setPaying(false); }
  }

  return <AppShell title="Indicações" subtitle="Alunos com saldo a receber do Indique e ganhe. Pague por PIX e marque como pago."
    action={<button type="button" onClick={() => load()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm text-ink hover:bg-wash"><RefreshCw size={15} /> Atualizar</button>}>
    {notice ? <Toast message={notice} /> : null}
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Alunos a pagar" value={toPay.length} icon={<Gift size={18} />} />
        <StatCard label="Total a pagar" value={formatBRL(totalToPay)} />
        <StatCard label="Alunos com indicação" value={rows.length} />
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} /> Mostrar também quem não tem saldo</label>
      {error ? <ErrorState message={error} /> : null}
      {loading && !rows.length ? <LoadingState /> : visible.length ? <DataTable columns={["Aluno", "Código", "Pagantes", "Ganho", "Já pago", "A receber", "Chave PIX", ""]} rows={visible.map((row) => [
        <div key="name"><div className="font-medium text-ink">{row.accountName}</div><div className="text-xs text-muted">{row.ownerEmail || "Sem e-mail"}</div></div>,
        <span key="code" className="font-mono text-sm text-ink">{row.code || "—"}</span>,
        <span key="count" className="text-ink">{row.payingCount}</span>,
        <span key="earned" className="whitespace-nowrap text-ink">{formatBRL(row.earnedCents)}</span>,
        <span key="paid" className="whitespace-nowrap text-muted">{formatBRL(row.paidOutCents)}{row.lastPaidAt ? <span className="block text-xs">em {new Date(row.lastPaidAt).toLocaleDateString("pt-BR")}</span> : null}</span>,
        <span key="balance" className="whitespace-nowrap font-semibold text-ink">{formatBRL(row.balanceCents)}</span>,
        row.pixKey ? <div key="pix" className="flex items-center gap-2"><span className="max-w-[220px] break-all text-sm text-ink">{row.pixKey}</span><CopyButton value={row.pixKey} /></div> : <span key="pix" className="text-sm text-amber-700">Sem chave PIX</span>,
        row.balanceCents > 0 ? <button key="action" type="button" onClick={() => { setSelected(row); setNote(""); }} className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover"><CheckCircle2 size={15} /> Marcar como pago</button> : <span key="action" className="text-xs text-muted">Em dia</span>,
      ])} /> : <EmptyState title={showAll ? "Nenhuma indicação ainda" : "Ninguém para pagar"} description={showAll ? "Quando alguém assinar por um link de indicação, aparece aqui." : "Nenhum aluno tem saldo a receber agora."} />}
    </div>

    <ConfirmModal open={Boolean(selected)} title="Marcar como pago?" confirmLabel="Marcar como pago" loading={paying} onCancel={() => setSelected(null)} onConfirm={markPaid}>
      {selected ? <div className="space-y-3">
        <p>Confirme só depois de mandar o PIX de <strong>{formatBRL(selected.balanceCents)}</strong> para <strong>{selected.accountName}</strong>.</p>
        <p className="text-sm">Chave PIX: <strong>{selected.pixKey || "não informada"}</strong></p>
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="Observação (opcional)" className="focus-ring h-10 w-full rounded-lg border border-line bg-white px-3 text-sm" />
      </div> : null}
    </ConfirmModal>
  </AppShell>;
}
