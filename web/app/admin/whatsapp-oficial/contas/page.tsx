"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, KeyRound, LockKeyhole, Plus, RefreshCw, ShieldCheck, Smartphone, X } from "lucide-react";
import { ActionButton, AppShell, ConfirmModal, CopyButton, ErrorState, LoadingState } from "@/components/ui";
import type { ConnectionSummary } from "../connection-select";

const emptyForm = { label: "", appId: "", businessPortfolioId: "", wabaId: "", phoneNumberId: "", accessToken: "", appSecret: "", graphVersion: "v25.0" };
const inputClass = "mt-1.5 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-black focus:ring-2 focus:ring-black/5 disabled:bg-wash";

export default function OfficialAccountsPage() {
  const [accounts, setAccounts] = useState<ConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const [secret, setSecret] = useState<{ label: string; token: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ account: ConnectionSummary; action: "disable" | "subscribe" | "webhook-token" } | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");

  async function load() {
    const response = await fetch("/api/admin/official/connections", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao carregar contas.");
    setAccounts(data.connections || []);
  }
  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/webhooks/meta`);
    load().catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  async function action(account: ConnectionSummary, body: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(account.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/official/connections/${account.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
      if (data.verifyToken) setSecret({ label: account.label, token: data.verifyToken });
      setNotice(body.action === "test" ? "Credenciais e acesso à Meta verificados. Nenhuma mensagem foi enviada." : "Conta atualizada com sucesso.");
      setConfirmation(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha na conexão."); }
    finally { lock.current = false; setBusy(""); }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy("save"); setError(""); setNotice("");
    try {
      const response = await fetch(editing ? `/api/admin/official/connections/${editing}` : "/api/admin/official/connections", { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(editing ? { action: "credentials", credentials: form } : form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      if (data.verifyToken) setSecret({ label: form.label, token: data.verifyToken });
      setNotice(editing ? "Credenciais substituídas e validadas." : "Credenciais validadas. Finalize o webhook abaixo para receber respostas e confirmações de entrega.");
      setForm(emptyForm); setShowForm(false); setEditing(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao salvar."); }
    finally { lock.current = false; setBusy(""); }
  }

  function edit(account: ConnectionSummary) {
    setForm({ ...emptyForm, label: account.label, appId: account.app_id || "", businessPortfolioId: account.business_portfolio_id || "", wabaId: account.waba_id || "", phoneNumberId: account.phone_number_id, graphVersion: account.graph_version });
    setEditing(account.id); setShowForm(true); setSecret(null); setError("");
  }

  return <AppShell title="Contas de API oficial" subtitle="Conecte seus números da Meta e escolha por qual conta enviar cada campanha.">
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/admin/whatsapp-oficial" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={16} /> WhatsApp Oficial</Link>
      <section className="overflow-hidden rounded-2xl bg-neutral-950 p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="max-w-xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs text-emerald-200"><ShieldCheck size={14} /> Conexão manual protegida</div><h2 className="text-2xl font-semibold tracking-tight">Suas contas. Um só painel.</h2><p className="mt-2 text-sm leading-6 text-neutral-300">Cadastre cada número com as credenciais do aplicativo correspondente. O Disparei valida o acesso antes de salvar e mantém cada envio vinculado à conta escolhida.</p></div>
          <ActionButton icon={<Plus size={18} />} disabled={Boolean(busy)} onClick={() => { setEditing(null); setForm(emptyForm); setShowForm(true); setSecret(null); }} className="bg-white text-black hover:bg-neutral-100">Conectar conta</ActionButton>
        </div>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/15 pt-4 text-xs text-neutral-300"><span className="flex items-center gap-2"><LockKeyhole size={14} /> Tokens e App Secret criptografados</span><span className="flex items-center gap-2"><ShieldCheck size={14} /> Acesso exclusivo do administrador</span><span className="flex items-center gap-2"><CheckCircle2 size={14} /> Conta atual preservada</span></div>
      </section>

      {error ? <ErrorState message={error} /> : null}
      {notice ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div> : null}

      {secret ? <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <h2 className="font-semibold text-amber-950">Finalize o webhook · {secret.label}</h2>
        <p className="mt-2 text-sm text-amber-900">Copie este token agora: ele é mostrado uma única vez. No aplicativo da Meta, abra WhatsApp → Configuração, informe a URL e o token abaixo e assine o campo <strong>messages</strong>.</p>
        <div className="mt-4 space-y-3">
          <div className="rounded-xl bg-white p-3"><div className="text-xs text-muted">URL de retorno (Callback URL)</div><div className="mt-1 flex items-center justify-between gap-3"><code className="break-all text-sm">{callbackUrl}</code><CopyButton value={callbackUrl} /></div></div>
          <div className="rounded-xl bg-white p-3"><div className="text-xs text-muted">Token de verificação · não é o Access Token</div><div className="mt-1 flex items-center justify-between gap-3"><code className="break-all text-sm">{secret.token}</code><CopyButton value={secret.token} /></div></div>
        </div>
        <p className="mt-3 text-sm text-amber-900">Depois, use “Vincular aplicativo” na conta e “Testar conexão”. Se o mesmo aplicativo atende vários números, configure o callback uma vez e vincule cada WABA.</p>
        <button type="button" className="mt-4 text-sm font-semibold underline" onClick={() => setSecret(null)}>Já copiei, ocultar token</button>
      </section> : null}

      {showForm ? <section className="rounded-2xl border border-line bg-panel p-6 shadow-soft">
        <div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">{editing ? "Atualizar credenciais" : "Conectar nova conta"}</h2><p className="mt-1 text-sm text-muted">Use os IDs da API, não o número de telefone com DDD.</p></div><button aria-label="Fechar formulário" disabled={Boolean(busy)} onClick={() => { setShowForm(false); setForm(emptyForm); setEditing(null); }}><X size={20} /></button></div>
        <form onSubmit={save} autoComplete="off" className="mt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Nome para identificar a conta<input required maxLength={80} minLength={2} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Ex.: Comercial · BM 2" className={inputClass} /></label>
            <label className="text-sm font-medium">ID do portfólio / BM <span className="font-normal text-muted">(opcional)</span><input inputMode="numeric" pattern="[0-9]{5,30}" value={form.businessPortfolioId} onChange={(e) => setForm({ ...form, businessPortfolioId: e.target.value })} className={inputClass} /></label>
            {([['appId', 'App ID · aplicativo'], ['wabaId', 'WABA ID · conta WhatsApp'], ['phoneNumberId', 'Phone Number ID · número']] as const).map(([field, label]) => <label key={field} className="text-sm font-medium">{label}<input required disabled={Boolean(editing)} inputMode="numeric" pattern="[0-9]{5,30}" value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} className={inputClass} /></label>)}
            <label className="text-sm font-medium">Versão da Graph API<input required pattern="v[0-9]{2,3}\.[0-9]+" value={form.graphVersion} onChange={(e) => setForm({ ...form, graphVersion: e.target.value })} className={inputClass} /></label>
          </div>
          <div className="grid gap-4 rounded-xl border border-line bg-wash p-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Access Token<input required type="password" autoComplete="new-password" minLength={40} maxLength={4096} value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} placeholder="Token do usuário do sistema" className={inputClass} /></label>
            <label className="text-sm font-medium">App Secret<input required type="password" autoComplete="new-password" minLength={16} maxLength={512} value={form.appSecret} onChange={(e) => setForm({ ...form, appSecret: e.target.value })} placeholder="Segredo do aplicativo correspondente" className={inputClass} /></label>
            <p className="text-xs leading-5 text-muted sm:col-span-2">Gere o token com acesso à WABA e às permissões whatsapp_business_management e whatsapp_business_messaging. Evite tokens temporários de teste. Os segredos nunca aparecem na listagem nem ficam no armazenamento do navegador.</p>
          </div>
          <ActionButton type="submit" disabled={Boolean(busy)} icon={busy === "save" ? <RefreshCw size={16} className="animate-spin" /> : <LockKeyhole size={16} />}>{busy === "save" ? "Validando na Meta…" : "Validar e salvar com segurança"}</ActionButton>
        </form>
      </section> : null}

      {loading ? <LoadingState /> : <div className="grid gap-5 lg:grid-cols-2">{accounts.map((account) => {
        const legacy = account.source === "legacy";
        const ready = legacy || (account.webhook_verified_at && account.app_subscribed);
        return <section key={account.id} className="flex flex-col rounded-2xl border border-line bg-panel p-6 shadow-soft">
          <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-wash p-3"><Smartphone size={22} /></div><div><h3 className="font-semibold text-ink">{account.label}</h3><p className="mt-1 text-sm text-muted">{account.display_phone_number || account.verified_name || "Número oficial"}</p></div></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${account.status !== "connected" ? "bg-red-50 text-red-700" : ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{account.status === "disabled" ? "Desativada" : account.status === "error" ? "Revisar acesso" : legacy ? "Conta atual" : ready ? "Configurada" : "Finalizar webhook"}</span></div>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs text-muted">WABA</dt><dd className="mt-1 break-all">{account.waba_name || account.waba_id || "—"}</dd></div><div><dt className="text-xs text-muted">Qualidade Meta</dt><dd className="mt-1">{({ GREEN: "Alta", YELLOW: "Média · atenção", RED: "Baixa · revisar envios" } as Record<string, string>)[account.quality_rating || ""] || "Não consultada"}</dd></div><div><dt className="text-xs text-muted">Phone Number ID</dt><dd className="mt-1 break-all font-mono text-xs">{account.phone_number_id}</dd></div><div><dt className="text-xs text-muted">Último teste</dt><dd className="mt-1">{account.last_tested_at ? new Date(account.last_tested_at).toLocaleString("pt-BR") : "—"}</dd></div></dl>
          {!legacy ? <div className="mt-4 rounded-xl bg-wash p-3 text-xs leading-6 text-muted"><div>{account.webhook_verified_at ? "✓" : "○"} Callback verificado {account.webhook_verified_at ? "pela Meta" : "· configure na Meta"}</div><div>{account.app_subscribed ? "✓" : "○"} Aplicativo {account.app_subscribed ? "vinculado à WABA" : "ainda não vinculado"}</div><div>Confira também a assinatura do campo messages no aplicativo.</div></div> : <p className="mt-4 text-xs leading-5 text-muted">Configuração atual do servidor preservada. Não precisa recadastrar este número.</p>}
          {account.last_error ? <p className="mt-3 text-sm text-red-700">{account.last_error}</p> : null}
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
            {legacy ? <Link href="/admin/whatsapp-oficial/configuracoes" className="text-sm font-medium underline">Ver conexão atual</Link> : <>
              <ActionButton disabled={Boolean(busy) || account.status === "disabled"} className="border border-line bg-white text-ink hover:bg-wash" icon={<RefreshCw size={14} className={busy === account.id ? "animate-spin" : ""} />} onClick={() => action(account, { action: "test" })}>Testar conexão</ActionButton>
              {!account.app_subscribed && account.status !== "disabled" ? <ActionButton disabled={Boolean(busy)} onClick={() => setConfirmation({ account, action: "subscribe" })}>Vincular aplicativo</ActionButton> : null}
              <button disabled={Boolean(busy)} onClick={() => edit(account)} className="px-2 text-xs font-medium underline">Trocar credenciais</button>
              <button disabled={Boolean(busy)} onClick={() => setConfirmation({ account, action: "webhook-token" })} className="px-2 text-xs font-medium underline">Novo token do webhook</button>
              <button disabled={Boolean(busy)} onClick={() => account.status === "disabled" ? action(account, { status: "connected" }) : setConfirmation({ account, action: "disable" })} className="px-2 text-xs text-red-700 underline">{account.status === "disabled" ? "Reativar" : "Desativar"}</button>
            </>}
          </div>
        </section>;
      })}</div>}
      {!loading && !accounts.length && !error ? <p className="rounded-2xl border border-dashed border-line p-8 text-center text-muted">Nenhuma conta cadastrada. Comece por “Conectar conta”.</p> : null}
      <section className="rounded-xl border border-line bg-wash p-5 text-sm leading-6 text-muted"><h3 className="flex items-center gap-2 font-semibold text-ink"><KeyRound size={16} /> Antes do primeiro disparo</h3><p className="mt-2">Confirme cadastro do número, pagamento e templates aprovados no WhatsApp Manager. Conectar outra conta não aumenta automaticamente os limites da Meta. Este painel não faz rodízio para contornar restrições: você escolhe o remetente e testa antes de enviar.</p><Link href="/admin/whatsapp-oficial/disparos" className="mt-3 inline-block font-semibold text-ink underline">Ir para disparos 1x1</Link></section>
    </div>
    <ConfirmModal open={Boolean(confirmation)} title={confirmation?.action === "disable" ? "Desativar esta conta?" : confirmation?.action === "subscribe" ? "Vincular aplicativo à WABA?" : "Gerar outro token do webhook?"} onCancel={() => setConfirmation(null)} onConfirm={() => confirmation && action(confirmation.account, confirmation.action === "disable" ? { status: "disabled" } : { action: confirmation.action })} loading={Boolean(busy)} confirmLabel="Confirmar">
      {confirmation?.action === "disable" ? "Novos envios e respostas automáticas por esta conta serão bloqueados. O histórico será preservado. Pause campanhas em andamento antes de continuar." : confirmation?.action === "subscribe" ? "O aplicativo associado a este token será inscrito para receber eventos desta WABA. Configure também o callback e o campo messages na Meta. Nenhuma mensagem será enviada." : "O token anterior de verificação será substituído. Copie o novo token e atualize a configuração do webhook no aplicativo da Meta."}
    </ConfirmModal>
  </AppShell>;
}
