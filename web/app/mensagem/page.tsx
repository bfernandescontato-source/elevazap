"use client";

import { ActionButton, AppShell, Toast } from "@/components/ui";
import { Send } from "lucide-react";
import { useMemo, useState } from "react";

export default function MensagemPage() {
  const [message, setMessage] = useState("Olá {{nome}}, sua compra foi aprovada. Bem-vindo(a)!");
  const [toast, setToast] = useState("");
  const preview = useMemo(() => message.replaceAll("{{nome}}", "Marina"), [message]);
  async function save() { await fetch("/api/mensagem/save", { method: "POST", body: JSON.stringify({ welcome_message: message }) }); setToast("Mensagem salva."); }
  async function test() { await fetch("/api/mensagem/test", { method: "POST" }); setToast("Teste enfileirado."); }
  return <AppShell title="Mensagem" subtitle="Boas-vindas para compradores e alunos">
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <section className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <label className="text-sm font-medium">Mensagem de boas-vindas</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={10} className="focus-ring mt-2 w-full rounded-lg border border-line p-3" />
        <div className="mt-2 text-sm text-muted">{message.length} caracteres. Variável disponível: {"{{nome}}"}</div>
        <div className="mt-5 flex flex-wrap gap-2"><ActionButton onClick={save}>Salvar</ActionButton><ActionButton icon={<Send size={16} />} className="border border-line bg-panel text-ink" onClick={test}>Enviar teste</ActionButton></div>
      </section>
      <aside className="rounded-lg border border-line bg-panel p-5 shadow-soft"><div className="text-sm font-medium">Preview</div><div className="mt-4 rounded-lg bg-wash p-4 text-sm leading-6">{preview}</div></aside>
    </div><Toast message={toast} />
  </AppShell>;
}
