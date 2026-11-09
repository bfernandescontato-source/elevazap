"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Gift, Loader2, RefreshCw, Save, Users, Wallet } from "lucide-react";
import { AppShell, CopyButton, DataTable, EmptyState, ErrorState, LoadingState, ProgressBar, StatCard, Toast } from "@/components/ui";
import { formatBRL, REFERRAL_STATUS_LABEL, REWARD_BLOCK_SIZE, type ReferralStatus, type ReferralSummary } from "@/modules/referrals/rules";

type Overview = {
  code: string;
  link: string;
  pixKey: string | null;
  summary: ReferralSummary;
  referrals: Array<{ id: string; firstName: string; status: ReferralStatus; createdAt: string }>;
  payouts: Array<{ id: string; amountCents: number; paidAt: string }>;
};

const STATUS_CLASS: Record<ReferralStatus, string> = {
  paying: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-zinc-50 text-zinc-700 border-zinc-200",
  refunded: "bg-red-50 text-red-700 border-red-200",
};

export default function IndiquePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/indique", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar sua indicação.");
      setData(body);
      setPixKey(body.pixKey || "");
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível carregar sua indicação.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function savePix(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/indique", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pixKey: pixKey.trim() || null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar a chave PIX.");
      setNotice("Chave PIX salva.");
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível salvar a chave PIX.");
    } finally { setSaving(false); }
  }

  const summary = data?.summary;

  return <AppShell title="Indique e ganhe" subtitle="A cada 5 pessoas que assinarem pelo seu link, você ganha R$ 25."
    action={<button type="button" onClick={() => load()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm text-ink hover:bg-wash"><RefreshCw size={15} /> Atualizar</button>}>
    {notice ? <Toast message={notice} /> : null}
    {loading && !data ? <LoadingState /> : error && !data ? <ErrorState message={error} /> : data && summary ? <div className="space-y-6">
      <section className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-white"><Gift size={18} /></div><div><h2 className="font-semibold text-ink">Seu link de indicação</h2><p className="text-sm text-muted">A cada 5 pessoas que assinarem pelo seu link, você ganha R$ 25.</p></div></div>
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase text-muted">Link</div>
            <div className="mt-1 flex flex-wrap items-center gap-2"><code className="min-w-0 break-all rounded-lg border border-line bg-wash px-3 py-2 text-sm text-ink">{data.link}</code><CopyButton value={data.link} /></div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-muted">Código</div>
            <div className="mt-1 flex items-center gap-2"><code className="rounded-lg border border-line bg-wash px-3 py-2 text-sm font-semibold tracking-wide text-ink">{data.code}</code><CopyButton value={data.code} /></div>
          </div>
        </div>
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium text-ink">{summary.progressInBlock} de {REWARD_BLOCK_SIZE} para o próximo R$ 25</span><span className="text-muted">{summary.payingCount} pagante(s) no total</span></div>
          <ProgressBar value={(summary.progressInBlock / REWARD_BLOCK_SIZE) * 100} />
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total ganho" value={formatBRL(summary.earnedCents)} icon={<Gift size={18} />} />
        <StatCard label="Já pago" value={formatBRL(summary.paidOutCents)} icon={<Wallet size={18} />} />
        <StatCard label="A receber" value={formatBRL(summary.balanceCents)} icon={<Wallet size={18} />} />
      </div>

      <section className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <h2 className="font-semibold text-ink">Chave PIX para receber</h2>
        <p className="text-sm text-muted">Usamos essa chave para mandar o seu dinheiro.</p>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={savePix}>
          <input value={pixKey} onChange={(event) => setPixKey(event.target.value)} maxLength={140} placeholder="CPF, e-mail, telefone ou chave aleatória" className="focus-ring h-11 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm" />
          <button disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Salvar chave</button>
        </form>
        {error ? <div className="mt-3"><ErrorState message={error} /></div> : null}
      </section>

      <section className="min-w-0 space-y-4">
        <div className="flex items-center gap-3"><Users size={20} className="text-muted" /><div><h2 className="font-semibold text-ink">Seus indicados</h2><p className="text-sm text-muted">Só conta quem pagou. Reembolso sai da conta.</p></div></div>
        {data.referrals.length ? <DataTable columns={["Nome", "Data", "Status"]} rows={data.referrals.map((item) => [
          <span key="name" className="font-medium text-ink">{item.firstName}</span>,
          <span key="date" className="whitespace-nowrap text-muted">{new Date(item.createdAt).toLocaleDateString("pt-BR")}</span>,
          <span key="status" className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[item.status] || STATUS_CLASS.pending}`}>{REFERRAL_STATUS_LABEL[item.status] || item.status}</span>,
        ])} /> : <EmptyState title="Nenhum indicado ainda" description="Mande seu link para quem quer disparar no WhatsApp." />}
      </section>

      {data.payouts.length ? <section className="min-w-0 space-y-4">
        <h2 className="font-semibold text-ink">Pagamentos recebidos</h2>
        <DataTable columns={["Data", "Valor"]} rows={data.payouts.map((item) => [
          <span key="date" className="text-muted">{new Date(item.paidAt).toLocaleDateString("pt-BR")}</span>,
          <span key="value" className="font-medium text-ink">{formatBRL(item.amountCents)}</span>,
        ])} />
      </section> : null}
    </div> : null}
  </AppShell>;
}
