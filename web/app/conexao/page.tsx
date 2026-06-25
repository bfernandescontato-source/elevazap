"use client";

import { ActionButton, AlertCard, AppShell, ConnectionStatusCard, ErrorState, LoadingState, Toast } from "@/components/ui";
import { QrCode, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

export default function ConexaoPage() {
  const [status, setStatus] = useState<any>(null);
  const [qr, setQr] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  async function load() {
    try {
      const [s, q] = await Promise.all([fetch("/api/whatsapp/status").then((r) => r.json()), fetch("/api/whatsapp/qr").then((r) => r.json())]);
      setStatus(s); setQr(q.qr || "");
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); const id = setInterval(load, 3000); return () => clearInterval(id); }, []);
  async function logout() { await fetch("/api/whatsapp/logout", { method: "POST" }); setToast("Sessão desconectada."); load(); }
  async function restart() { await fetch("/api/whatsapp/restart", { method: "POST" }); setToast("Gerando novo QR Code."); setTimeout(load, 1000); }
  return <AppShell title="Conexão" subtitle="QR Code e estado do socket Baileys">
    <div className="space-y-5">
      {status?.status !== "connected" ? <AlertCard title="Desconectado">Abra o WhatsApp no celular e escaneie o QR Code quando ele aparecer.</AlertCard> : null}
      {error ? <ErrorState message={error} /> : !status ? <LoadingState /> : <ConnectionStatusCard status={status.status} qr={qr} />}
      <div className="flex flex-wrap gap-2"><ActionButton icon={<RefreshCw size={16} />} onClick={load}>Atualizar QR</ActionButton><ActionButton icon={<QrCode size={16} />} className="border border-line bg-panel text-ink" onClick={restart}>Gerar novo QR</ActionButton><ActionButton icon={<X size={16} />} className="border border-line bg-panel text-ink" onClick={logout}>Desconectar</ActionButton></div>
      <Toast message={toast} />
    </div>
  </AppShell>;
}
