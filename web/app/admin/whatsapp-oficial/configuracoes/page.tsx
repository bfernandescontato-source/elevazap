"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionButton, AppShell, ConfirmModal, CopyButton, ErrorState, LoadingState } from "@/components/ui";
import { ConnectionSelect } from "../connection-select";
import { QuickReplyPanel } from "../quick-reply-panel";

type Status = { connected: boolean; phoneNumber: { displayPhoneNumber?: string; verifiedName?: string }; waba: { name?: string }; configStatus: { graphVersion: string | null } };
type Template = { name: string; language: string; status: string };
export default function OfficialSettingsPage() {
  const [connectionId, setConnectionId] = useState("legacy");
  const [status, setStatus] = useState<Status | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [webhook, setWebhook] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [phone, setPhone] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setError(""); setStatus(null); setTemplates([]); setTemplateName("");
    Promise.all([fetch(`/api/admin/official/status?connectionId=${connectionId}`), fetch(`/api/admin/official/templates?connectionId=${connectionId}`), fetch("/api/admin/official/hubla-webhook-url")]).then(async responses => {
      const [s, t, w] = await Promise.all(responses.map(r => r.json()));
      if (!active) return;
      if (!responses[0].ok || !responses[1].ok) throw new Error(s.error || t.error || "Falha ao consultar a Meta.");
      setStatus(s); setTemplates(t.templates || []); setWebhook(w.url || "");
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [connectionId, revision]);
  async function send() {
    if (sending) return; setSending(true); setError("");
    try {
      const response = await fetch("/api/admin/official/test-send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, templateName, connectionId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Falha ao enviar teste.");
      setNotice("Teste aceito pela Meta. Acompanhe a entrega no Histórico."); setConfirm(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao enviar."); }
    finally { setSending(false); }
  }
  return <AppShell title="Configurações da API" subtitle="Conexão, webhook da Hubla e testes técnicos. As automações ficam em sua própria página."><div className="mx-auto max-w-5xl space-y-6">
    {error ? <ErrorState message={error} /> : null}{notice ? <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p> : null}
    <section className="rounded-2xl border border-line bg-panel p-6"><ConnectionSelect value={connectionId} onChange={setConnectionId} disabled={sending} />{loading ? <LoadingState /> : <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{status?.connected ? "Conectado à Meta" : "Revisar conexão"}</h2><p className="mt-1 text-sm text-muted">{[status?.phoneNumber.displayPhoneNumber, status?.phoneNumber.verifiedName, status?.configStatus.graphVersion].filter(Boolean).join(" · ")}</p></div><ActionButton onClick={() => setRevision(r => r + 1)} disabled={loading}>Testar conexão</ActionButton></div>}<Link className="mt-4 inline-block text-sm underline" href="/admin/whatsapp-oficial/contas">Gerenciar contas e credenciais</Link></section>
    <section className="rounded-2xl border border-line bg-panel p-6"><h2 className="font-semibold">Receber compras da Hubla</h2><p className="mt-2 text-sm text-muted">Configure este webhook na Hubla. O produto e o evento determinam qual automação será executada.</p>{webhook ? <div className="mt-4 flex items-center gap-3 rounded-xl bg-wash p-3"><code className="min-w-0 flex-1 truncate text-xs">{webhook}</code><CopyButton value={webhook} /></div> : <p className="mt-3 text-sm text-muted">Webhook não disponível. Confira a configuração do servidor.</p>}<Link href="/admin/whatsapp-oficial/automacoes" className="mt-4 inline-block text-sm underline">Configurar automações por produto</Link></section>
    <section className="rounded-2xl border border-line bg-panel p-6"><h2 className="font-semibold">Teste de mensagem inicial</h2><p className="mt-1 text-sm text-muted">Teste isolado, com valores de exemplo. Não executa uma automação de compra.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Telefone<input value={phone} onChange={e => setPhone(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line px-3" placeholder="+55 19 99999-9999" /></label><label className="text-sm font-medium">Modelo aprovado<select value={templateName} onChange={e => setTemplateName(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3"><option value="">Selecione</option>{templates.filter(t => t.status === "APPROVED").map(t => <option key={`${t.name}-${t.language}`} value={t.name}>{t.name} · {t.language}</option>)}</select></label></div><ActionButton className="mt-4" disabled={!phone || !templateName || sending} onClick={() => setConfirm(true)}>Enviar teste</ActionButton></section>
    <section className="rounded-2xl border border-line bg-panel p-6"><h2 className="font-semibold">Integrações e compatibilidade</h2><Link href="/admin/whatsapp-oficial/entradas-externas" className="mt-3 inline-block text-sm underline">Entradas externas: formulários, roletas e outras fontes</Link><p className="mt-3 text-sm text-muted">Respostas antigas continuam disponíveis para não interromper mensagens já enviadas. Para novos produtos, configure a segunda mensagem dentro da automação.</p><button type="button" className="mt-4 text-sm underline" onClick={() => setLegacyOpen(!legacyOpen)}>{legacyOpen ? "Ocultar" : "Consultar"} respostas antigas</button>{legacyOpen ? <div className="mt-5 space-y-5 border-t border-line pt-5"><QuickReplyPanel /></div> : null}</section>
  </div><ConfirmModal open={confirm} title="Enviar mensagem real de teste?" onCancel={() => setConfirm(false)} onConfirm={send} loading={sending} confirmLabel="Enviar teste">Uma mensagem será enviada para {phone} pela conta selecionada. Use um destinatário que autorizou esse teste.</ConfirmModal></AppShell>;
}
