"use client";

import { AppShell, EmptyState, LoadingState } from "@/components/ui";
import { CreditCard, KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserRound, Users } from "lucide-react";
import { useEffect, useState } from "react";

type Tab = "account" | "users" | "security" | "billing";
type AccountData = { name: string | null; email: string; role: string };

const tabs = [
  { id: "account" as const, label: "Minha conta", icon: UserRound },
  { id: "users" as const, label: "Usuários", icon: Users },
  { id: "security" as const, label: "Segurança", icon: ShieldCheck },
  { id: "billing" as const, label: "Planos e cobrança", icon: CreditCard }
];

export default function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>("account");
  const [account, setAccount] = useState<AccountData | null>(null);

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" }).then((response) => response.json()).then((data) => setAccount(data.account || null));
  }, []);

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
          <div className="mt-6 rounded-lg border border-line bg-wash p-4 text-sm text-muted">A edição desses dados será habilitada quando o cadastro de perfis estiver conectado ao sistema de autenticação.</div>
        </section> : null}

        {account && tab === "users" ? <section className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-ink">Usuários</h2><p className="mt-1 text-sm text-muted">Pessoas com acesso a esta conta.</p></div><button disabled title="Disponível quando a gestão de usuários for habilitada" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-black px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"><Plus size={16} />Adicionar usuário</button></div>
          <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-soft">
            <div className="grid gap-3 p-4 sm:grid-cols-[1fr_180px_auto] sm:items-center"><div><div className="font-medium text-ink">{account.name || account.email}</div><div className="mt-1 text-sm text-muted">{account.email}</div></div><span className="w-fit rounded-full border border-line bg-wash px-2.5 py-1 text-xs font-medium">{account.role}</span><div className="flex gap-1"><button disabled title="Edição ainda não disponível" className="rounded-lg p-2 text-muted disabled:opacity-35"><Pencil size={16} /></button><button disabled title="O administrador principal não pode ser removido" className="rounded-lg p-2 text-red-600 disabled:opacity-25"><Trash2 size={16} /></button></div></div>
          </div>
          <p className="rounded-lg border border-line bg-wash p-4 text-sm text-muted">Hoje o projeto possui um único acesso administrativo. A interface está preparada para receber múltiplos usuários quando essa função for conectada ao backend.</p>
        </section> : null}

        {account && tab === "security" ? <section className="max-w-2xl rounded-lg border border-line bg-panel p-6 shadow-soft">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-black text-white"><KeyRound size={18} /></div><div><h2 className="text-lg font-semibold text-ink">Alterar senha</h2><p className="text-sm text-muted">Proteja seu acesso com uma senha exclusiva.</p></div></div>
          <div className="mt-6 space-y-4"><label className="block text-sm font-medium text-ink">Nova senha<input disabled type="password" placeholder="Mínimo de 8 caracteres" className="mt-1 h-11 w-full rounded-lg border border-line bg-wash px-3 disabled:cursor-not-allowed" /></label><label className="block text-sm font-medium text-ink">Confirmar nova senha<input disabled type="password" placeholder="Repita a nova senha" className="mt-1 h-11 w-full rounded-lg border border-line bg-wash px-3 disabled:cursor-not-allowed" /></label><button disabled className="h-10 rounded-lg bg-black px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">Atualizar senha</button></div>
          <div className="mt-6 rounded-lg border border-line bg-wash p-4 text-sm text-muted">A senha atual é gerenciada pelo ambiente seguro da aplicação. Alteração e recuperação serão habilitadas quando o serviço de usuários estiver disponível.</div>
        </section> : null}

        {account && tab === "billing" ? <section className="space-y-5"><div><h2 className="text-lg font-semibold text-ink">Planos e cobrança</h2><p className="mt-1 text-sm text-muted">Plano, limites e informações de assinatura.</p></div><EmptyState title="Cobrança ainda não configurada" description="Nenhum provedor de assinatura está conectado. Quando houver dados reais, plano, status, limites e opções de alteração aparecerão aqui." /></section> : null}
      </div>
    </div>
  </AppShell>;
}
