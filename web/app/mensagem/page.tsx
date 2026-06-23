"use client";

import { ActionButton, AppShell, Toast } from "@/components/ui";
import { Check, Clipboard, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const sample = {
  nome: "Marina",
  produto: "Curso Eleva",
  email: "marina@email.com",
  telefone: "5511999999999",
  order_id: "pedido_123",
  transaction_id: "transacao_456"
};

function renderPreview(template: string) {
  return template
    .replaceAll("{{nome}}", sample.nome)
    .replaceAll("{{produto}}", sample.produto)
    .replaceAll("{{email}}", sample.email)
    .replaceAll("{{telefone}}", sample.telefone)
    .replaceAll("{{order_id}}", sample.order_id)
    .replaceAll("{{transaction_id}}", sample.transaction_id);
}

export default function MensagemPage() {
  const [message, setMessage] = useState("Olá {{nome}}, sua compra de {{produto}} foi aprovada. Bem-vindo(a)!");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [copied, setCopied] = useState("");
  const [toast, setToast] = useState("");
  const preview = useMemo(() => renderPreview(message), [message]);

  useEffect(() => {
    fetch("/api/mensagem/save")
      .then((r) => r.json())
      .then((data) => {
        if (data.welcome_message) setMessage(data.welcome_message);
        if (data.webhook_url) setWebhookUrl(data.webhook_url);
      })
      .catch(() => undefined);
  }, []);

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(""), 1200);
  }

  async function save() {
    const response = await fetch("/api/mensagem/save", { method: "POST", body: JSON.stringify({ welcome_message: message }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao salvar mensagem.");
    setToast("Mensagem de compra aprovada salva.");
  }

  async function test() {
    const response = await fetch("/api/mensagem/test", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao enfileirar teste.");
    setToast("Teste enfileirado.");
  }

  return <AppShell title="Mensagem" subtitle="Compra aprovada pela ElevaPay">
    <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <section className="space-y-5">
        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold text-ink">Webhook da ElevaPay</h2>
          <div className="mt-4 rounded-lg border border-line bg-wash p-3">
            <div className="text-xs font-medium uppercase text-muted">URL para cadastrar na ElevaPay</div>
            <div className="mt-2 break-all font-mono text-sm text-ink">{webhookUrl || "Carregando..."}</div>
          </div>
          <div className="mt-3 rounded-lg border border-line bg-wash p-3">
            <div className="text-xs font-medium uppercase text-muted">Header obrigatório</div>
            <div className="mt-2 font-mono text-sm text-ink">x-elevapay-token</div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton icon={copied === "url" ? <Check size={16} /> : <Clipboard size={16} />} disabled={!webhookUrl} onClick={() => copy(webhookUrl, "url")}>Copiar URL</ActionButton>
            <ActionButton icon={copied === "header" ? <Check size={16} /> : <Clipboard size={16} />} className="border border-line bg-panel text-ink" onClick={() => copy("x-elevapay-token", "header")}>Copiar header</ActionButton>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <label className="text-sm font-medium text-ink">Mensagem de compra aprovada</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={10} className="focus-ring mt-2 w-full rounded-lg border border-line p-3 text-sm" />
          <div className="mt-2 text-sm text-muted">{message.length} caracteres.</div>
          <div className="mt-5 flex flex-wrap gap-2">
            <ActionButton onClick={() => save().catch((e) => setToast(e.message))}>Salvar mensagem</ActionButton>
            <ActionButton icon={<Send size={16} />} className="border border-line bg-panel text-ink" onClick={() => test().catch((e) => setToast(e.message))}>Enviar teste</ActionButton>
          </div>
        </div>
      </section>

      <aside className="space-y-5">
        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <div className="text-sm font-medium text-ink">Variáveis da compra</div>
          <div className="mt-4 grid gap-2 text-sm">
            {["{{nome}}", "{{produto}}", "{{email}}", "{{telefone}}", "{{order_id}}", "{{transaction_id}}"].map((variable) => <button key={variable} className="rounded-lg border border-line px-3 py-2 text-left font-mono hover:bg-wash" onClick={() => setMessage((current) => `${current}${current.endsWith(" ") || !current ? "" : " "}${variable}`)}>{variable}</button>)}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <div className="text-sm font-medium text-ink">Preview</div>
          <div className="mt-4 rounded-lg bg-wash p-4 text-sm leading-6 whitespace-pre-wrap">{preview}</div>
        </div>
      </aside>
    </div>
    <Toast message={toast} />
  </AppShell>;
}
