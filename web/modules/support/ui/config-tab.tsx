"use client";

import { ActionButton, AlertCard, ConnectionStatusCard, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { BookOpen, Bot, Check, ChevronRight, DollarSign, Inbox, MessageSquare, Pause, Play, Plus, QrCode, RefreshCw, Send, Trash2, User, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { fmt, statusColor, statusLabel, type Agent, type Conversation, type KBEntry, type Message, type RefundRequest } from "./support-domain";

export function ConfigTab({ notify }: { notify: (m: string) => void }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [session, setSession] = useState<{ status: string; qr: string; llmReady?: boolean; agentEnabled?: boolean }>({ status: "disconnected", qr: "" });
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingSessionRef = useRef(false);

  const loadAgent = useCallback(async () => {
    try {
      const res = await fetch("/api/support/agent");
      if (!res.ok) throw new Error("Falha ao carregar agente.");
      const { agent } = await res.json();
      setAgent(agent);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    if (loadingSessionRef.current) return;
    loadingSessionRef.current = true;
    try {
    const res = await fetch("/api/support/status").catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setSession(data);
    }
    } finally {
      loadingSessionRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadAgent();
    loadSession();
    pollRef.current = setInterval(loadSession, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadAgent, loadSession]);

  async function save() {
    if (!agent) return;
    setSaving(true);
    try {
      const res = await fetch("/api/support/agent", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(agent)
      });
      if (!res.ok) throw new Error("Falha ao salvar.");
      notify("Configuração salva.");
      loadSession();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function connectNew() {
    setConnecting(true);
    try {
      const res = await fetch("/api/support/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error((await res.json()).error || "Falha ao iniciar sessão.");
      notify("Iniciando sessão. Aguarde o QR code.");
      await loadSession();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await fetch("/api/support/status", { method: "DELETE" });
    notify("Sessão desconectada.");
    await loadSession();
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!agent) return <ErrorState message="Agente não encontrado." />;

  const isConnected = session.status === "connected";
  const iaReady = isConnected && agent.enabled && session.llmReady !== false;

  return (
    <div className="space-y-5">
      {/* Session card */}
      <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-ink">Número de suporte</h2>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${isConnected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
            {session.status}
          </span>
        </div>
        {session.qr && (
          <div className="mb-4 flex justify-center rounded-lg bg-wash p-5">
            <Image src={session.qr} alt="QR Code" width={256} height={256} unoptimized className="h-64 w-64 rounded-lg bg-white p-2" />
          </div>
        )}
        {!isConnected && !session.qr && (
          <AlertCard title="Nenhum número conectado">
            Conecte um número dedicado ao suporte escaneando um QR code.
          </AlertCard>
        )}
        <div className="mt-4 flex gap-2">
          <ActionButton icon={<QrCode size={16} />} onClick={connectNew} disabled={connecting}>
            {connecting ? "Aguarde..." : "Conectar número via QR"}
          </ActionButton>
          {isConnected && (
            <ActionButton icon={<X size={16} />} className="border border-line bg-panel text-ink" onClick={disconnect}>
              Desconectar
            </ActionButton>
          )}
        </div>
        <div className={`mt-4 rounded-lg border p-3 text-sm ${iaReady ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {iaReady ? "IA pronta para responder." : !isConnected ? "Conecte o número de suporte para a IA responder." : !agent.enabled ? "Ative o agente e salve a configuração." : "OPENAI_API_KEY não configurada no Railway do whatsapp-service."}
        </div>
      </div>

      {/* Agent toggle */}
      <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-ink">Agente ativo</div>
            <div className="text-sm text-muted">Ativar resposta automática por IA</div>
          </div>
          <button
            onClick={() => setAgent({ ...agent, enabled: !agent.enabled })}
            className={`relative h-7 w-12 rounded-full transition ${agent.enabled ? "bg-accent" : "bg-line"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${agent.enabled ? "left-6" : "left-1"}`} />
          </button>
        </div>
      </div>

      {/* System prompt */}
      <div className="rounded-lg border border-line bg-panel p-5 shadow-soft space-y-4">
        <h2 className="font-semibold text-ink">Configurações da IA</h2>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Persona / Prompt do sistema</label>
          <textarea
            rows={6}
            className="focus-ring w-full rounded-lg border border-line bg-wash p-3 text-sm"
            placeholder="Você é um assistente de suporte da [Empresa]. Seja cordial, objetivo e resolva problemas com empatia..."
            value={agent.system_prompt}
            onChange={(e) => setAgent({ ...agent, system_prompt: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Modelo</label>
            <select
              className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
              value={agent.model}
              onChange={(e) => setAgent({ ...agent, model: e.target.value })}
            >
              <option value="gpt-4o-mini">gpt-4o-mini (econômico)</option>
              <option value="gpt-4o">gpt-4o (qualidade)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Temperatura</label>
            <input type="number" min="0" max="2" step="0.1"
              className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
              value={agent.temperature}
              onChange={(e) => setAgent({ ...agent, temperature: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Histórico máximo</label>
            <input type="number" min="5" max="100"
              className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
              value={agent.max_history}
              onChange={(e) => setAgent({ ...agent, max_history: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Janela de agregação (s)</label>
            <input type="number" min="1" max="60"
              className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
              value={agent.aggregation_seconds}
              onChange={(e) => setAgent({ ...agent, aggregation_seconds: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Pausa após takeover (min)</label>
            <input type="number" min="5"
              className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
              value={agent.human_takeover_minutes}
              onChange={(e) => setAgent({ ...agent, human_takeover_minutes: Number(e.target.value) })}
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Mensagem fora do horário</label>
          <input
            className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
            value={agent.fallback_message}
            onChange={(e) => setAgent({ ...agent, fallback_message: e.target.value })}
          />
        </div>

        <ActionButton onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar configuração"}
        </ActionButton>
      </div>
    </div>
  );
}
