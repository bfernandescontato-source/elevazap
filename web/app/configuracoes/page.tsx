"use client";

import { AppShell, EmptyState, LoadingState } from "@/components/ui";
import { CreditCard, KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserRound, Users } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";

type Tab = "account" | "users" | "security" | "billing";
type AccountData = { name: string | null; email: string; role: string };
type Capabilities = { userManagement: boolean; passwordChange: boolean };
type ManagedUser = { id: string; email: string; name: string | null; role: "admin" | "operator"; status: "pending" | "active" | "disabled"; created_at: string };

const tabs = [
  { id: "account" as const, label: "Minha conta", icon: UserRound },
  { id: "users" as const, label: "Usuários", icon: Users },
  { id: "security" as const, label: "Segurança", icon: ShieldCheck },
  { id: "billing" as const, label: "Planos e cobrança", icon: CreditCard }
];

export default function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>("account");
  const [account, setAccount] = useState<AccountData | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({ userManagement: false, passwordChange: false });
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [userError, setUserError] = useState("");

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" }).then((response) => response.json()).then((data) => { setAccount(data.account || null); setCapabilities(data.capabilities || {}); });
  }, []);

  useEffect(() => {
    if (tab !== "users" || !capabilities.userManagement) return;
    fetch("/api/users", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao carregar usuários.");
      setUsers(data.users || []);
    }).catch((error) => setUserError(error.message));
  }, [tab, capabilities.userManagement]);

  async function updateUser(id: string, change: Partial<Pick<ManagedUser, "status" | "role">>) {
    const response = await fetch("/api/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...change }) });
    const data = await response.json();
    if (!response.ok) return setUserError(data.error || "Falha ao atualizar usuário.");
    setUsers((current) => current.map((user) => user.id === id ? data.user : user));
    setUserError("");
  }

  return <AppShell title="Configurações" subtitle="Conta, acesso, segurança e cobrança">
    <div className="grid gap-6 xl:grid-cols-[240px_1fr]">
      <nav aria-label="Configurações da conta" className="flex gap-2 overflow-x-auto xl:flex-col">
        {tabs.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`inline-flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition ${tab === item.id ? "bg-black text-white" : "border border-line bg-white text-muted hover:text-ink"}`}><Icon size={17} />{item.label}</button>;
        })}
      </nav>

      <div className="min-w-0">
        {!account ? <LoadingState /> : tab === "account" ? <section className="max-w-2xl rounded-lg border border-line bg-panel p-6 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Minha conta</h2>
          <p className="mt-1 text-sm text-muted">Dados básicos usados para identificar seu acesso ao Disparei.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">Nome<input readOnly value={account.name || ""} placeholder="Nome não informado" className="mt-1 h-11 w-full rounded-lg border border-line bg-wash px-3 text-muted" /></label>
            <label className="text-sm font-medium text-ink">E-mail<input readOnly value={account.email} className="mt-1 h-11 w-full rounded-lg border border-line bg-wash px-3 text-muted" /></label>
            <label className="text-sm font-medium text-ink">Nível de acesso<input readOnly value={account.role} className="mt-1 h-11 w-full rounded-lg border border-line bg-wash px-3 text-muted" /></label>
          </div>
          <div className="mt-6 rounded-lg border border-line bg-wash p-4 text-sm text-muted">O e-mail e o nível de acesso são gerenciados pelo sistema seguro de autenticação.</div>
        </section> : null}

        {account && tab === "users" ? <section className="space-y-5">
          <div><h2 className="text-lg font-semibold text-ink">Usuários</h2><p className="mt-1 text-sm text-muted">Aprove, bloqueie e defina o nível de acesso dos cadastros.</p></div>
          {userError ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{userError}</div> : null}
          {!capabilities.userManagement ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Somente administradores podem gerenciar usuários.</div> : <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel shadow-soft">
            {users.map((user) => <div key={user.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_140px_150px_auto] lg:items-center">
              <div><div className="font-medium text-ink">{user.name || user.email}</div><div className="mt-1 text-sm text-muted">{user.email}</div></div>
              <span className="w-fit rounded-full border border-line bg-wash px-2.5 py-1 text-xs font-medium">{user.status === "active" ? "Ativo" : user.status === "pending" ? "Pendente" : "Desativado"}</span>
              <select value={user.role} onChange={(event) => updateUser(user.id, { role: event.target.value as ManagedUser["role"] })} className="h-10 rounded-lg border border-line bg-white px-3 text-sm"><option value="operator">Operador</option><option value="admin">Administrador</option></select>
              <button type="button" onClick={() => updateUser(user.id, { status: user.status === "active" ? "disabled" : "active" })} className={`h-10 rounded-lg px-3 text-sm font-medium ${user.status === "active" ? "border border-red-200 text-red-700" : "bg-black text-white"}`}>{user.status === "active" ? "Desativar" : "Aprovar"}</button>
            </div>)}
            {!users.length ? <div className="p-5 text-sm text-muted">Nenhum usuário cadastrado.</div> : null}
          </div>}
        </section> : null}

        {account && tab === "security" ? <section className="max-w-2xl rounded-lg border border-line bg-panel p-6 shadow-soft">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-black text-white"><KeyRound size={18} /></div><div><h2 className="text-lg font-semibold text-ink">Alterar senha</h2><p className="text-sm text-muted">Proteja seu acesso com uma senha exclusiva.</p></div></div>
          <div className="mt-6"><Link href="/recuperar-senha" className="inline-flex h-10 items-center rounded-lg bg-black px-4 text-sm font-medium text-white">Enviar link para alterar senha</Link></div>
          {!capabilities.passwordChange ? <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Este acesso ainda usa a credencial administrativa legada. Cadastre o mesmo e-mail no novo sistema para habilitar recuperação e magic link.</div> : null}
        </section> : null}

        {account && tab === "billing" ? <section className="space-y-5"><div><h2 className="text-lg font-semibold text-ink">Planos e cobrança</h2><p className="mt-1 text-sm text-muted">Plano, limites e informações de assinatura.</p></div><EmptyState title="Cobrança ainda não configurada" description="Nenhum provedor de assinatura está conectado. Quando houver dados reais, plano, status, limites e opções de alteração aparecerão aqui." /></section> : null}
      </div>
    </div>
  </AppShell>;
}
