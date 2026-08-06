"use client";

import { AppShell, LoadingState } from "@/components/ui";
import { CreditCard, KeyRound, ShieldCheck, UserRound, Users } from "lucide-react";
import { useEffect, useState } from "react";

type Tab = "account" | "users" | "security" | "billing";
type AccountData = {
  name: string | null;
  email: string;
  role: string;
  plan: string;
  planLabel: string;
  status: string;
  accountName: string | null;
};
type Limits = { maxSenders: number; unlimitedSenders: boolean };
type Usage = { senders: number };
type Capabilities = { userManagement: boolean; passwordChange: boolean; billing: boolean };
type ManagedUser = { id: string; email: string; name: string | null; role: "admin" | "operator"; status: "pending" | "active" | "disabled"; created_at: string };

const tabs = [
  { id: "account" as const, label: "Minha conta",      icon: UserRound },
  { id: "users"   as const, label: "Usuários",          icon: Users     },
  { id: "security" as const, label: "Segurança",        icon: ShieldCheck },
  { id: "billing"  as const, label: "Planos e cobrança", icon: CreditCard  },
];

const STATUS_LABELS: Record<string, string> = {
  active:    "Ativa",
  past_due:  "Pagamento pendente",
  suspended: "Suspensa",
  cancelled: "Cancelada",
  expired:   "Expirada",
  refunded:  "Reembolsada",
};

export default function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>("account");
  const [account, setAccount] = useState<AccountData | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({ userManagement: false, passwordChange: false, billing: false });
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [userError, setUserError] = useState("");

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      setAccount(data.account || null);
      setLimits(data.limits || null);
      setUsage(data.usage || null);
      setCapabilities(data.capabilities || {});
    });
  }, []);

  useEffect(() => {
    if (tab !== "users" || !capabilities.userManagement) return;
    fetch("/api/users", { cache: "no-store" }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Falha ao carregar usuários.");
      setUsers(data.users || []);
    }).catch((e) => setUserError(e.message));
  }, [tab, capabilities.userManagement]);

  async function updateUser(id: string, change: Partial<Pick<ManagedUser, "status" | "role">>) {
    const r = await fetch("/api/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...change }) });
    const data = await r.json();
    if (!r.ok) return setUserError(data.error || "Falha ao atualizar usuário.");
    setUsers((current) => current.map((u) => u.id === id ? data.user : u));
    setUserError("");
  }

  const senderUsageLabel = limits && usage
    ? limits.unlimitedSenders
      ? `${usage.senders} conectado(s)`
      : `${usage.senders} de ${limits.maxSenders}`
    : "—";
  const senderAtLimit = limits && usage && !limits.unlimitedSenders && usage.senders >= limits.maxSenders;

  return <AppShell title="Configurações" subtitle="Conta, acesso, segurança e cobrança">
    <div className="grid gap-6 xl:grid-cols-[240px_1fr]">
      <nav aria-label="Configurações da conta" className="flex gap-2 overflow-x-auto xl:flex-col">
        {tabs.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`inline-flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition ${tab === item.id ? "bg-black text-white" : "border border-line bg-white text-muted hover:text-ink"}`}><Icon size={17} />{item.label}</button>;
        })}
      </nav>

      <div className="min-w-0">
        {!account ? <LoadingState /> : null}

        {account && tab === "account" ? <section className="max-w-2xl rounded-lg border border-line bg-panel p-6 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Minha conta</h2>
          <p className="mt-1 text-sm text-muted">Dados básicos usados para identificar seu acesso ao Disparei.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">Nome<input readOnly value={account.name || ""} placeholder="Nome não informado" className="mt-1 h-11 w-full rounded-lg border border-line bg-wash px-3 text-muted" /></label>
            <label className="text-sm font-medium text-ink">E-mail<input readOnly value={account.email} className="mt-1 h-11 w-full rounded-lg border border-line bg-wash px-3 text-muted" /></label>
            <label className="text-sm font-medium text-ink">Nível de acesso<input readOnly value={account.role} className="mt-1 h-11 w-full rounded-lg border border-line bg-wash px-3 text-muted" /></label>
            <label className="text-sm font-medium text-ink">Plano<input readOnly value={account.planLabel || account.plan} className="mt-1 h-11 w-full rounded-lg border border-line bg-wash px-3 text-muted" /></label>
            <label className="text-sm font-medium text-ink">Status da assinatura<input readOnly value={STATUS_LABELS[account.status] || account.status} className="mt-1 h-11 w-full rounded-lg border border-line bg-wash px-3 text-muted" /></label>
          </div>
          <div className="mt-6 rounded-lg border border-line bg-wash p-4 text-sm text-muted">O e-mail e o nível de acesso são gerenciados pelo sistema seguro de autenticação.</div>
        </section> : null}

        {account && tab === "users" ? <section className="space-y-5">
          <div><h2 className="text-lg font-semibold text-ink">Usuários</h2><p className="mt-1 text-sm text-muted">Gerencie os acessos vinculados à sua conta.</p></div>
          {userError ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{userError}</div> : null}
          {!capabilities.userManagement ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Somente administradores podem gerenciar usuários.</div> : <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel shadow-soft">
            {users.map((user) => <div key={user.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_140px_150px_auto] lg:items-center">
              <div><div className="font-medium text-ink">{user.name || user.email}</div><div className="mt-1 text-sm text-muted">{user.email}</div></div>
              <span className="w-fit rounded-full border border-line bg-wash px-2.5 py-1 text-xs font-medium">{user.status === "active" ? "Ativo" : user.status === "pending" ? "Pendente" : "Desativado"}</span>
              <select value={user.role} onChange={(e) => updateUser(user.id, { role: e.target.value as ManagedUser["role"] })} className="h-10 rounded-lg border border-line bg-white px-3 text-sm"><option value="operator">Operador</option><option value="admin">Administrador</option></select>
              <button type="button" onClick={() => updateUser(user.id, { status: user.status === "active" ? "disabled" : "active" })} className={`h-10 rounded-lg px-3 text-sm font-medium ${user.status === "active" ? "border border-red-200 text-red-700" : "bg-black text-white"}`}>{user.status === "active" ? "Desativar" : "Aprovar"}</button>
            </div>)}
            {!users.length ? <div className="p-5 text-sm text-muted">Nenhum usuário cadastrado.</div> : null}
          </div>}
        </section> : null}

        {account && tab === "security" ? <section className="max-w-2xl rounded-lg border border-line bg-panel p-6 shadow-soft">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-black text-white"><KeyRound size={18} /></div><div><h2 className="text-lg font-semibold text-ink">Alterar senha</h2><p className="text-sm text-muted">Proteja seu acesso com uma senha exclusiva.</p></div></div>
          <form action="/api/auth/update-password" method="post" className="mt-6 max-w-md">
            <label className="text-sm font-medium text-ink">Nova senha<input name="password" type="password" minLength={8} required className="mt-1 h-11 w-full rounded-lg border border-line px-3" /></label>
            <label className="mt-4 block text-sm font-medium text-ink">Confirmar senha<input name="confirmation" type="password" minLength={8} required className="mt-1 h-11 w-full rounded-lg border border-line px-3" /></label>
            <button className="mt-5 h-10 rounded-lg bg-black px-4 text-sm font-medium text-white">Salvar nova senha</button>
          </form>
          {!capabilities.passwordChange ? <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Este acesso ainda usa a credencial administrativa legada. Cadastre o mesmo e-mail no novo sistema para habilitar recuperação e magic link.</div> : null}
        </section> : null}

        {account && tab === "billing" ? <section className="space-y-6 max-w-2xl">
          <div>
            <h2 className="text-lg font-semibold text-ink">Planos e cobrança</h2>
            <p className="mt-1 text-sm text-muted">Seu plano atual, uso de recursos e informações de assinatura.</p>
          </div>

          {/* Plano atual */}
          <div className="rounded-lg border border-line bg-panel p-6 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Plano atual</p>
                <p className="mt-1 text-2xl font-bold text-ink">{account.planLabel || account.plan}</p>
                <p className="mt-1 text-sm text-muted">Status: <span className={`font-medium ${account.status === "active" ? "text-green-700" : "text-amber-700"}`}>{STATUS_LABELS[account.status] || account.status}</span></p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${account.status === "active" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                {account.status === "active" ? "Ativo" : "Inativo"}
              </span>
            </div>
          </div>

          {/* Uso de recursos */}
          <div className="rounded-lg border border-line bg-panel p-6 shadow-soft">
            <h3 className="font-semibold text-ink">Uso de recursos</h3>
            <div className="mt-4 space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Números de WhatsApp</span>
                  <span className={`font-semibold ${senderAtLimit ? "text-amber-700" : "text-ink"}`}>{senderUsageLabel}</span>
                </div>
                {limits && !limits.unlimitedSenders && usage && (
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-wash">
                    <div
                      className={`h-2 rounded-full transition-all ${senderAtLimit ? "bg-amber-500" : "bg-black"}`}
                      style={{ width: `${Math.min(100, (usage.senders / limits.maxSenders) * 100)}%` }}
                    />
                  </div>
                )}
                {senderAtLimit && (
                  <p className="mt-2 text-xs text-amber-700">Limite atingido. Remova um número ou faça upgrade para adicionar mais.</p>
                )}
              </div>
            </div>
          </div>

          {/* Gerenciar assinatura */}
          <div className="rounded-lg border border-line bg-panel p-6 shadow-soft">
            <h3 className="font-semibold text-ink">Gerenciar assinatura</h3>
            <p className="mt-2 text-sm text-muted">
              Upgrades, downgrades e cancelamentos são feitos diretamente pela Hubla, plataforma de pagamento do Disparei.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href="https://hub.la/products"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-black px-4 text-sm font-medium text-white transition hover:bg-zinc-800"
              >
                Fazer upgrade do plano
              </a>
              <a
                href="https://hub.la/products"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-medium text-ink transition hover:bg-wash"
              >
                Gerenciar assinatura
              </a>
            </div>
          </div>
        </section> : null}
      </div>
    </div>
  </AppShell>;
}
