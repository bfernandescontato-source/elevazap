"use client";

import { AppShell, DataTable, SearchInput, StatusBadge, useApi } from "@/components/ui";
import { useMemo, useState } from "react";

export default function EnviosGrupoPage() {
  const { data } = useApi<any[]>("/api/envios-grupo", []);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => data.filter((e) => JSON.stringify(e).toLowerCase().includes(query.toLowerCase())), [data, query]);
  return <AppShell title="Envios em grupo" subtitle="Histórico de itens de lotes">
    <div className="mb-4"><SearchInput placeholder="Filtrar por grupo, lote ou status" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    <DataTable columns={["Lote", "Grupo", "Tipo", "Prévia", "Status", "Erro", "Tentativas", "Data"]} rows={rows.map((e) => [e.lote_id, e.nome_grupo, e.tipo, e.texto || e.legenda || e.file_name || "-", <StatusBadge key="s" status={e.status} />, e.erro || "-", e.attempts || 0, e.created_at ? new Date(e.created_at).toLocaleString() : "-"])} />
  </AppShell>;
}
