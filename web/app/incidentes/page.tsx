"use client";

import { AppShell, DataTable, EmptyState, StatusBadge, useApi } from "@/components/ui";
import { useMemo } from "react";

export default function IncidentesPage() {
  const { data } = useApi<{ envios: any[]; grupos: any[] }>("/api/incertos", { envios: [], grupos: [] });
  const { data: principal } = useApi<{ status?: string; phone_number?: string }>("/api/whatsapp/status", {});
  const { data: senderData } = useApi<{ senders: any[] }>("/api/whatsapp/senders", { senders: [] });
  const { data: batches } = useApi<any[]>("/api/lotes", []);
  const { data: campaigns } = useApi<any[]>("/api/campanhas", []);

  const incidents = useMemo(() => {
    const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
    const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign.nome]));
    return [
      ...(principal.status && principal.status !== "connected" ? [{ id: "sender-principal", type: "Número desconectado", origin: "Conexão", number: "Número principal", relation: "—", description: "Este número precisa ser reconectado para voltar a enviar mensagens.", status: "erro", date: undefined, action: "Abra Números e gere um novo QR Code.", technical: { status: principal.status } }] : []),
      ...senderData.senders.filter((sender) => sender.status !== "connected").map((sender) => ({ id: `sender-${sender.id}`, type: "Número desconectado", origin: "Conexão", number: sender.label, relation: "—", description: "Este número precisa ser reconectado para voltar a enviar mensagens.", status: "erro", date: sender.updated_at || sender.created_at, action: "Abra Números e gere um novo QR Code.", technical: { session_name: sender.session_name, status: sender.status } })),
      ...data.envios.map((item) => ({ id: item.id, type: "Envio não confirmado", origin: "Envio individual", number: item.whatsapp_session_name || "Número principal", relation: item.produto || "—", description: item.erro || "O WhatsApp não confirmou a entrega.", status: item.status, date: item.updated_at || item.created_at, action: "Revise o destinatário antes de tentar novamente.", technical: item })),
      ...data.grupos.map((item) => { const batch = batchMap.get(item.lote_id); return { id: item.id, type: "Envio para grupo não confirmado", origin: "Envio em grupo", number: item.whatsapp_session_name || "Número principal", relation: campaignMap.get(batch?.campanha_id) || batch?.titulo || item.lote_id || "—", description: item.erro || "O WhatsApp não confirmou o envio para este grupo.", status: item.status, date: item.updated_at || item.created_at, action: "Abra o lote e revise este envio.", technical: item }; })
    ];
  }, [data, principal, senderData.senders, batches, campaigns]);

  const formatDate = (value?: string) => value ? new Date(value).toLocaleString("pt-BR") : "—";
  return <AppShell title="Incidentes" subtitle="Problemas que precisam de atenção">
    {!incidents.length ? <EmptyState title="Não há incidentes registrados." description="Quando algo exigir atenção, aparecerá aqui com a ação recomendada." /> : <DataTable columns={["Tipo", "Origem", "Número", "Campanha ou lote", "Descrição", "Status", "Data e horário", "Ação recomendada", "Detalhes"]} rows={incidents.map((incident) => [incident.type, incident.origin, incident.number, incident.relation, incident.description, <StatusBadge key="status" status={incident.status} />, formatDate(incident.date), incident.action, <details key="details"><summary className="cursor-pointer font-medium">Abrir</summary><pre className="mt-2 max-w-md overflow-auto rounded-lg bg-wash p-3 text-xs">{JSON.stringify(incident.technical, null, 2)}</pre></details>])} />}
  </AppShell>;
}
