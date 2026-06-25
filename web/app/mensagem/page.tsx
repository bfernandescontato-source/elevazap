"use client";

import { ActionButton, AppShell, Toast } from "@/components/ui";
import { Check, Clipboard, Phone, Send, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const sample = {
  nome: "Marina",
  produto: "Curso Eleva",
  email: "marina@email.com",
  telefone: "5511999999999",
  order_id: "pedido_123",
  transaction_id: "transacao_456"
};

type BulkClient = {
  nome: string;
  telefone: string;
  email?: string;
  produto?: string;
  order_id?: string;
  transaction_id?: string;
  error?: string;
};

type Sender = {
  id: string;
  label: string;
  session_name: string;
  status?: string;
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

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\"") {
      if (quoted && line[i + 1] === "\"") { current += "\""; i++; }
      else quoted = !quoted;
    } else if ((char === "," || char === ";") && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseClientsCsv(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const aliases: Record<string, keyof BulkClient> = {
    nome: "nome",
    name: "nome",
    telefone: "telefone",
    phone: "telefone",
    whatsapp: "telefone",
    email: "email",
    produto: "produto",
    product: "produto",
    order_id: "order_id",
    pedido: "order_id",
    transaction_id: "transaction_id",
    transacao: "transaction_id"
  };
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: BulkClient = { nome: "", telefone: "" };
    headers.forEach((header, index) => {
      const key = aliases[header];
      if (key) row[key] = cells[index] || "";
    });
    if (!row.nome) row.error = "Nome ausente.";
    if (!row.telefone) row.error = "Telefone ausente.";
    return row;
  });
}

export default function MensagemPage() {
  const [message, setMessage] = useState("Olá {{nome}}, sua compra de {{produto}} foi aprovada. Bem-vindo(a)!");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [copied, setCopied] = useState("");
  const [toast, setToast] = useState("");
  const [bulkClients, setBulkClients] = useState<BulkClient[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState("");
  const preview = useMemo(() => renderPreview(message), [message]);
  const validBulkClients = useMemo(() => bulkClients.filter((client) => !client.error), [bulkClients]);
  const selectedSender = useMemo(() => senders.find((sender) => sender.id === selectedSenderId), [senders, selectedSenderId]);

  useEffect(() => {
    fetch("/api/mensagem/save")
      .then((r) => r.json())
      .then((data) => {
        if (data.welcome_message) setMessage(data.welcome_message);
        if (data.webhook_url) setWebhookUrl(data.webhook_url);
      })
      .catch(() => undefined);
    fetch("/api/whatsapp/senders")
      .then((r) => r.json())
      .then((data) => setSenders(data.senders || []))
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

  async function loadBulkFile(file: File) {
    const text = await file.text();
    const parsed = parseClientsCsv(text);
    setBulkClients(parsed);
    setToast(`${parsed.length} cliente(s) carregado(s).`);
  }

  async function sendBulk() {
    setBulkLoading(true);
    try {
      const response = await fetch("/api/mensagem/bulk", {
        method: "POST",
        body: JSON.stringify({ mensagem: message, clientes: validBulkClients, whatsapp_sender_id: selectedSenderId || undefined })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao enfileirar disparos.");
      setToast(`${data.enfileirados} cliente(s) colocados na fila. Acompanhe a entrega na tela Envios. ${data.erros || 0} linha(s) com erro.`);
    } finally {
      setBulkLoading(false);
    }
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

        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold text-ink">Disparo em massa 1x1</h2>
          <p className="mt-1 text-sm text-muted">Suba uma lista CSV de clientes e escolha qual número conectado vai fazer o disparo.</p>
          <div className="mt-4 rounded-lg border border-line bg-wash p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-ink"><Phone size={16} /> Número responsável pelo disparo</label>
            <select value={selectedSenderId} onChange={(e) => setSelectedSenderId(e.target.value)} className="focus-ring mt-3 h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm">
              <option value="">Número principal conectado</option>
              {senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label} ({sender.status || "desconectado"})</option>)}
            </select>
            <div className="mt-2 text-xs text-muted">{selectedSender ? `A planilha será disparada pelo número "${selectedSender.label}".` : "Sem seleção extra: usa o número principal da página Conexão."}</div>
          </div>
          <div className="mt-4 rounded-lg border border-dashed border-line bg-wash p-5">
            <label className="flex cursor-pointer flex-col items-center justify-center text-center">
              <Upload className="text-muted" />
              <span className="mt-2 text-sm font-medium text-ink">Selecionar CSV</span>
              <span className="mt-1 text-xs text-muted">Colunas: nome, telefone, email, produto</span>
              <input className="sr-only" type="file" accept=".csv,text/csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) loadBulkFile(file).catch((error) => setToast(error.message)); }} />
            </label>
          </div>
          <div className="mt-3 rounded-lg bg-wash p-3 font-mono text-xs text-muted">
            nome,telefone,email,produto<br />
            Maria Silva,11999999999,maria@email.com,Curso Eleva
          </div>
          {bulkClients.length ? <div className="mt-4">
            <div className="mb-2 text-sm text-muted">{validBulkClients.length} válido(s) de {bulkClients.length} cliente(s).</div>
            <div className="max-h-64 overflow-auto rounded-lg border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-wash text-xs uppercase text-muted"><tr><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Telefone</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody className="divide-y divide-line">{bulkClients.slice(0, 100).map((client, index) => <tr key={index}><td className="px-3 py-2">{client.nome || "-"}</td><td className="px-3 py-2 font-mono">{client.telefone || "-"}</td><td className="px-3 py-2">{client.email || "-"}</td><td className={`px-3 py-2 ${client.error ? "text-red-600" : "text-emerald-700"}`}>{client.error || "ok"}</td></tr>)}</tbody>
              </table>
            </div>
            <ActionButton icon={<Send size={16} />} disabled={!validBulkClients.length || bulkLoading} onClick={() => sendBulk().catch((error) => setToast(error.message))} className="mt-4 bg-accent text-white">{bulkLoading ? "Enfileirando..." : "Enfileirar disparos em massa"}</ActionButton>
          </div> : null}
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
