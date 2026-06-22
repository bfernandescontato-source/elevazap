"use client";

import { AppShell, Toast, UncertainStatusCard, useApi } from "@/components/ui";
import { useState } from "react";

export default function IncertosPage() {
  const { data } = useApi<any>("/api/incertos", { envios: [], grupos: [] });
  const [toast, setToast] = useState("");
  async function act(action: string, item: any, kind: "envio" | "grupo") {
    const map: Record<string, string> = { success: "mark-success", error: "mark-error", retry: "retry" };
    await fetch(`/api/incertos/${map[action]}`, { method: "POST", body: JSON.stringify({ id: item.id, kind, resolution_note: "Resolvido manualmente no painel." }) });
    setToast("Ação registrada.");
  }
  return <AppShell title="Incertos" subtitle="Decisão manual para evitar duplicidade automática">
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="space-y-3"><h2 className="font-semibold">Boas-vindas</h2>{data.envios.map((i: any) => <UncertainStatusCard key={i.id} critical item={i} onAction={(a) => act(a, i, "envio")} />)}</section>
      <section className="space-y-3"><h2 className="font-semibold">Grupos</h2>{data.grupos.map((i: any) => <UncertainStatusCard key={i.id} item={i} onAction={(a) => act(a, i, "grupo")} />)}</section>
    </div><Toast message={toast} />
  </AppShell>;
}
