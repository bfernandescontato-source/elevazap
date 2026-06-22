"use client";

import { ActionButton, AppShell, ConfirmModal, DataTable, DateTimePicker, FileDropzone, MediaPreview, SearchInput, StatusBadge, Toast } from "@/components/ui";
import { FolderPlus, RefreshCw, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Grupo = {
  group_jid: string;
  nome?: string;
  qtd_membros?: number;
  sou_admin?: boolean;
};

type Campanha = {
  id: string;
  nome: string;
  grupos: Grupo[];
};

type CampaignTarget = "all" | "single" | "manual";

export default function GruposPage() {
  const [groups, setGroups] = useState<Grupo[]>([]);
  const [campaigns, setCampaigns] = useState<Campanha[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [campaignTarget, setCampaignTarget] = useState<CampaignTarget>("all");
  const [campaignSingleGroup, setCampaignSingleGroup] = useState("");
  const [campaignManualGroups, setCampaignManualGroups] = useState<string[]>([]);
  const [tipo, setTipo] = useState("texto");
  const [texto, setTexto] = useState("");
  const [legenda, setLegenda] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scheduled, setScheduled] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState("");

  async function loadGroups() {
    const data = await fetch("/api/whatsapp/groups").then((r) => r.json());
    setGroups(data.groups || data || []);
  }

  async function loadCampaigns() {
    const data = await fetch("/api/campanhas").then((r) => r.json());
    setCampaigns(Array.isArray(data) ? data : []);
  }

  async function loadAll() {
    await Promise.all([loadGroups(), loadCampaigns()]);
  }

  useEffect(() => { loadAll(); }, []);

  const filtered = useMemo(() => groups.filter((g) => (g.nome || "").toLowerCase().includes(query.toLowerCase())), [groups, query]);
  const selectedCampaign = useMemo(() => campaigns.find((c) => c.id === selectedCampaignId), [campaigns, selectedCampaignId]);
  const selectedCampaignGroups = selectedCampaign?.grupos || [];
  const selectedCampaignJids = selectedCampaignGroups.map((g) => g.group_jid);

  function toggleSelected(jid: string, checked: boolean) {
    setSelected((current) => checked ? Array.from(new Set([...current, jid])) : current.filter((item) => item !== jid));
  }

  function applyCampaign(campaignId: string) {
    setSelectedCampaignId(campaignId);
    const campaign = campaigns.find((c) => c.id === campaignId);
    const jids = campaign?.grupos.map((g) => g.group_jid) || [];
    setCampaignTarget("all");
    setCampaignSingleGroup(jids[0] || "");
    setCampaignManualGroups(jids);
    if (campaignId) setSelected(jids);
  }

  function changeCampaignTarget(target: CampaignTarget) {
    setCampaignTarget(target);
    if (!selectedCampaign) return;
    if (target === "all") setSelected(selectedCampaignJids);
    if (target === "single") setSelected(campaignSingleGroup ? [campaignSingleGroup] : selectedCampaignJids.slice(0, 1));
    if (target === "manual") setSelected(campaignManualGroups);
  }

  function changeSingleCampaignGroup(jid: string) {
    setCampaignSingleGroup(jid);
    setSelected(jid ? [jid] : []);
  }

  function toggleCampaignManualGroup(jid: string, checked: boolean) {
    setCampaignManualGroups((current) => {
      const next = checked ? Array.from(new Set([...current, jid])) : current.filter((item) => item !== jid);
      setSelected(next);
      return next;
    });
  }

  async function createCampaign() {
    const response = await fetch("/api/campanhas", {
      method: "POST",
      body: JSON.stringify({ nome: campaignName, group_jids: selected })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao criar campanha.");
    setCampaignName("");
    setToast("Campanha criada.");
    await loadCampaigns();
  }

  async function createLote() {
    let media;
    if (file && tipo !== "texto") {
      const signed = await fetch("/api/upload/signed-url", {
        method: "POST",
        body: JSON.stringify({ tipo, file_name: file.name, mime_type: file.type, file_size_bytes: file.size })
      }).then((r) => r.json());
      if (signed.error) throw new Error(signed.error);
      await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
      await fetch("/api/upload/confirm", { method: "POST", body: JSON.stringify({ storage_path: signed.storage_path }) });
      media = { bucket: signed.bucket, storage_path: signed.storage_path, file_name: file.name, mime_type: file.type, file_size_bytes: file.size };
    }
    const response = await fetch("/api/lotes/create", {
      method: "POST",
      body: JSON.stringify({ titulo: `Lote ${new Date().toLocaleString()}`, group_jids: selected, tipo, texto, legenda, scheduled_at: scheduled ? new Date(scheduled).toISOString() : undefined, media })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao criar lote.");
    setConfirm(false);
    setToast("Lote criado.");
  }

  return <AppShell title="Grupos" subtitle="Grupos próprios em que o número já participa">
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1"><SearchInput placeholder="Buscar grupo" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <ActionButton icon={<RefreshCw size={16} />} onClick={async () => { await fetch("/api/whatsapp/groups/refresh", { method: "POST" }); loadGroups(); }}>Atualizar</ActionButton>
        </div>

        <div className="rounded-lg border border-line bg-panel p-4 shadow-soft">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="flex-1">
              <label className="text-sm font-medium text-ink">Nome da campanha</label>
              <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Ex: Campanha lançamento" className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3 text-sm" />
            </div>
            <ActionButton icon={<FolderPlus size={16} />} disabled={!campaignName.trim() || !selected.length} onClick={() => createCampaign().catch((e) => setToast(e.message))}>Criar campanha</ActionButton>
          </div>
          <div className="mt-3 text-sm text-muted">{selected.length} grupo(s) selecionado(s).</div>
        </div>

        <DataTable columns={["", "Grupo", "Membros", "Admin", "JID"]} rows={filtered.map((g) => [
          <input key={g.group_jid} type="checkbox" checked={selected.includes(g.group_jid)} onChange={(e) => toggleSelected(g.group_jid, e.target.checked)} />,
          <span key="n" className="font-medium">{g.nome || "Sem nome"}</span>,
          g.qtd_membros || 0,
          <StatusBadge key="a" status={g.sou_admin ? "sucesso" : "pendente"} />,
          <span key="j" className="font-mono text-xs">{g.group_jid}</span>
        ])} />
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold">Campanhas</h2>
          <select value={selectedCampaignId} onChange={(e) => applyCampaign(e.target.value)} className="focus-ring mt-4 h-11 w-full rounded-lg border border-line px-3 text-sm">
            <option value="">Seleção manual</option>
            {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.nome} ({campaign.grupos.length})</option>)}
          </select>

          {selectedCampaign ? <div className="mt-4 space-y-3">
            <select value={campaignTarget} onChange={(e) => changeCampaignTarget(e.target.value as CampaignTarget)} className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm">
              <option value="all">Todos os grupos da campanha</option>
              <option value="single">Um grupo específico</option>
              <option value="manual">Selecionar grupos da campanha</option>
            </select>

            {campaignTarget === "single" ? <select value={campaignSingleGroup} onChange={(e) => changeSingleCampaignGroup(e.target.value)} className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm">
              {selectedCampaignGroups.map((group) => <option key={group.group_jid} value={group.group_jid}>{group.nome || group.group_jid}</option>)}
            </select> : null}

            {campaignTarget === "manual" ? <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-line p-3">
              {selectedCampaignGroups.map((group) => <label key={group.group_jid} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={campaignManualGroups.includes(group.group_jid)} onChange={(e) => toggleCampaignManualGroup(group.group_jid, e.target.checked)} />
                <span>{group.nome || group.group_jid}</span>
              </label>)}
            </div> : null}
          </div> : null}
        </div>

        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold">Composer</h2>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="focus-ring mt-4 h-11 w-full rounded-lg border border-line px-3"><option value="texto">Texto</option><option value="imagem">Imagem</option><option value="video">Vídeo</option><option value="audio">Áudio</option><option value="audio_voz">Áudio de voz</option><option value="documento">Documento</option></select>
          <textarea placeholder="Texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} className="focus-ring mt-3 w-full rounded-lg border border-line p-3" />
          {tipo !== "texto" ? <><input placeholder="Legenda" value={legenda} onChange={(e) => setLegenda(e.target.value)} className="focus-ring mt-3 h-11 w-full rounded-lg border border-line px-3" /><div className="mt-3"><FileDropzone onFile={setFile} /></div><div className="mt-3"><MediaPreview fileName={file?.name} mimeType={file?.type} /></div></> : null}
          <div className="mt-3"><DateTimePicker value={scheduled} onChange={(e) => setScheduled(e.target.value)} /></div>
          <ActionButton icon={<Send size={16} />} disabled={!selected.length} onClick={() => setConfirm(true)} className="mt-4 w-full bg-accent text-white">Enviar ou agendar</ActionButton>
        </div>
      </aside>
    </div>
    <ConfirmModal open={confirm} title="Confirmar lote" onCancel={() => setConfirm(false)} onConfirm={() => createLote().catch((e) => setToast(e.message))}>Serão criados {selected.length} itens. O serviço enviará um grupo por vez, pela fila global.</ConfirmModal>
    <Toast message={toast} />
  </AppShell>;
}
