"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Eye, EyeOff, Loader2, Plus, RefreshCw, Users } from "lucide-react";
import { AppShell, ConfirmModal, DataTable, EmptyState, ErrorState, LoadingState, StatusBadge, Toast } from "@/components/ui";

type Plan = "start" | "pro" | "scale";
type AccountRow = {
  id: string;
  name: string;
  status: string;
  plan: Plan | string;
  created_at: string;
  owner: { id: string; email: string; name: string | null; status: string } | null;
};

const PLAN_DETAILS: Record<Plan, { label: string; senders: number }> = {
  start: { label: "START", senders: 1 },
  pro: { label: "PRO", senders: 3 },
  scale: { label: "SCALE", senders: 10 },
};

const INITIAL_FORM = { name: "", email: "", password: "123456", plan: "start" as Plan };

export default function AdminAccountsPage() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [lastCredentials, setLastCredentials] = useState<{ email: string; password: string } | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/accounts", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar as contas.");
      setAccounts(body.accounts || []);
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível carregar as contas.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const canSubmit = useMemo(() => form.name.trim().length >= 2 && form.email.includes("@") && form.password.length >= 6, [form]);

  function requestCreate(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) setConfirmOpen(true);
  }

  async function createAccount() {
    setSubmitting(true); setError(""); setNotice("");
    const credentials = { email: form.email.trim().toLowerCase(), password: form.password };
    try {
      const response = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível criar a conta.");
      setLastCredentials(credentials);
      setNotice(`Conta ${PLAN_DETAILS[form.plan].label} criada com sucesso.`);
      setForm(INITIAL_FORM);
      setConfirmOpen(false);
      await loadAccounts();
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível criar a conta.");
    } finally { setSubmitting(false); }
  }

  async function copyCredentials() {
    if (!lastCredentials) return;
    await navigator.clipboard.writeText(`Acesso Disparei\nE-mail: ${lastCredentials.email}\nSenha temporária: ${lastCredentials.password}\nLogin: ${window.location.origin}/login`);
    setNotice("Credenciais copiadas.");
  }

  return <AppShell title="Administração de contas" subtitle="Crie uma conta completa, defina o plano e entregue o acesso em poucos segundos."
    action={<button type="button" onClick={() => loadAccounts()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm text-ink hover:bg-wash"><RefreshCw size={15} /> Atualizar</button>}>
    {notice ? <Toast message={notice} /> : null}
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,430px)_1fr]">
      <section className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-black text-white"><Plus size={18} /></div><div><h2 className="font-semibold text-ink">Nova conta</h2><p className="text-sm text-muted">O usuário será administrador e já ficará ativo.</p></div></div>
        <form className="mt-6 space-y-4" onSubmit={requestCreate}>
          <Field label="Nome da conta"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} maxLength={80} placeholder="Ex.: Leonardo da Kelly" className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 text-sm" /></Field>
          <Field label="E-mail de acesso"><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required type="email" autoComplete="off" placeholder="cliente@email.com" className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 text-sm" /></Field>
          <Field label="Senha temporária">
            <div className="relative"><input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={6} maxLength={72} type={showPassword ? "text" : "password"} autoComplete="new-password" className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 pr-11 text-sm" /><button type="button" title={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShowPassword((current) => !current)} className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-wash">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            <p className="mt-1 text-xs text-muted">Padrão inicial: 123456. Oriente o cliente a trocar depois.</p>
          </Field>
          <Field label="Plano">
            <div className="grid grid-cols-3 gap-2">{(Object.keys(PLAN_DETAILS) as Plan[]).map((plan) => <button key={plan} type="button" onClick={() => setForm({ ...form, plan })} className={`rounded-lg border px-3 py-3 text-left transition ${form.plan === plan ? "border-black bg-black text-white" : "border-line bg-white text-ink hover:bg-wash"}`}><span className="block text-sm font-semibold">{PLAN_DETAILS[plan].label}</span><span className={`mt-1 block text-xs ${form.plan === plan ? "text-white/70" : "text-muted"}`}>{PLAN_DETAILS[plan].senders} número(s)</span></button>)}</div>
          </Field>
          {error ? <ErrorState message={error} /> : null}
          <button disabled={!canSubmit || submitting} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-black px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40">{submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Criar conta</button>
        </form>
        {lastCredentials ? <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-center gap-2 font-medium text-emerald-800"><CheckCircle2 size={17} /> Último acesso criado</div><div className="mt-2 text-sm text-emerald-900"><div>{lastCredentials.email}</div><div>Senha: {lastCredentials.password}</div></div><button type="button" onClick={copyCredentials} className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 text-sm font-medium text-emerald-800"><Copy size={14} /> Copiar credenciais</button></div> : null}
      </section>

      <section className="min-w-0 space-y-4">
        <div className="flex items-center gap-3"><Users size={20} className="text-muted" /><div><h2 className="font-semibold text-ink">Contas recentes</h2><p className="text-sm text-muted">As 50 contas mais recentes e seus responsáveis.</p></div></div>
        {loading ? <LoadingState /> : error && !accounts.length ? <ErrorState message={error} /> : accounts.length ? <DataTable columns={["Conta", "Responsável", "Plano", "Status", "Criada em"]} rows={accounts.map((account) => [
          <div key="account"><div className="font-medium text-ink">{account.name}</div><div className="text-xs text-muted">{account.id}</div></div>,
          <div key="owner"><div className="text-ink">{account.owner?.name || "—"}</div><div className="text-xs text-muted">{account.owner?.email || "Sem responsável"}</div></div>,
          <span key="plan" className="font-medium text-ink">{String(account.plan).toUpperCase()}</span>,
          <StatusBadge key="status" status={account.status} />,
          <span key="date" className="whitespace-nowrap text-muted">{new Date(account.created_at).toLocaleString("pt-BR")}</span>,
        ])} /> : <EmptyState title="Nenhuma conta" description="Crie a primeira conta pelo formulário ao lado." />}
      </section>
    </div>

    <ConfirmModal open={confirmOpen} title="Criar esta conta?" confirmLabel="Criar conta" loading={submitting} onCancel={() => setConfirmOpen(false)} onConfirm={createAccount}>
      Será criada uma conta <strong>{PLAN_DETAILS[form.plan].label}</strong> ativa para <strong>{form.email.trim().toLowerCase()}</strong>, com o usuário como administrador e a senha temporária informada.
    </ConfirmModal>
  </AppShell>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>{children}</label>;
}
