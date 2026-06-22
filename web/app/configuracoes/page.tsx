"use client";

import { AppShell, DataTable, StatusBadge, useApi } from "@/components/ui";

export default function ConfiguracoesPage() {
  const { data } = useApi<any>("/api/whatsapp/status", {});
  const vars = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "WHATSAPP_SERVICE_URL", "INTERNAL_API_KEY", "ELEVAPAY_WEBHOOK_TOKEN", "ADMIN_EMAIL", "ADMIN_PASSWORD_HASH", "AUTH_SECRET"];
  return <AppShell title="Configurações" subtitle="Ambiente, fila e políticas">
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <h2 className="font-semibold">Serviço</h2>
        <div className="mt-4 grid gap-3 text-sm">
          <div className="flex justify-between"><span>Status</span><StatusBadge status={data.status} /></div>
          <div className="flex justify-between"><span>Lock</span><span>{data.lock || "sem dados"}</span></div>
          <div className="flex justify-between"><span>FFmpeg</span><span>{data.ffmpeg || "sem dados"}</span></div>
          <div className="flex justify-between"><span>Fila</span><span>{data.queue?.size || 0}</span></div>
          <div className="flex justify-between"><span>Prioridade alta</span><span>{data.queue?.highPriority || 0}</span></div>
          <div className="flex justify-between"><span>Prioridade normal</span><span>{data.queue?.normalPriority || 0}</span></div>
          <div className="flex justify-between"><span>WELCOME_UNCERTAIN_POLICY</span><span>manual</span></div>
          <div className="flex justify-between"><span>Baileys</span><span>6.7.23</span></div>
        </div>
      </section>
      <section><h2 className="mb-3 font-semibold">Variáveis</h2><DataTable columns={["Nome", "Valor"]} rows={vars.map((v) => [v, v.includes("EMAIL") ? "configurado no ambiente" : "oculto"])} /></section>
    </div>
  </AppShell>;
}
