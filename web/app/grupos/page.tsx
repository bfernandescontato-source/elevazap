"use client";

import { ActionButton, AppShell, ConfirmModal, DateTimePicker, FileDropzone, MediaPreview, Toast } from "@/components/ui";
import { FileText, FolderPlus, Plus, RefreshCw, Save, Send, Trash2, X } from "lucide-react";
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

type Pasta = {
  id: string;
  nome: string;
};

type Modelo = {
  id: string;
  pasta_id?: string | null;
  nome: string;
  tipo: MessageKind;
  texto?: string | null;
  media_bucket?: string | null;
  media_path?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
};

type Tab = "campanhas" | "disparo";
type CampaignTarget = "all" | "single" | "manual";
type MessageSource = "manual" | "modelo";
type MessageKind = "texto" | "imagem" | "video" | "audio" | "documento";

const messageKindLabels: Record<MessageKind, string> = {
  texto: "Apenas texto",
  imagem: "Texto + imagem",
  video: "Texto + vídeo",
  audio: "Áudio",
  documento: "Documento"
};

export default function GruposPage() {
  const [tab, setTab] = useState<Tab>("campanhas");
  const [groups, setGroups] = useState<Grupo[]>([]);
  const [campaigns, setCampaigns] = useState<Campanha[]>([]);
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [toast, setToast] = useState("");

  const [campaignName, setCampaignName] = useState("");
  const [campaignGroupQuery, setCampaignGroupQuery] = useState("");
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false);
  const [newCampaignGroups, setNewCampaignGroups] = useState<string[]>([]);
  const [addGroupsByCampaign, setAddGroupsByCampaign] = useState<Record<string, string[]>>({});

  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [campaignTarget, setCampaignTarget] = useState<CampaignTarget>("all");
  const [singleGroup, setSingleGroup] = useState("");
  const [manualGroups, setManualGroups] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const [messageSource, setMessageSource] = useState<MessageSource>("manual");
  const [selectedModeloId, setSelectedModeloId] = useState("");
  const [tipo, setTipo] = useState<MessageKind>("texto");
  const [texto, setTexto] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mentionAll, setMentionAll] = useState(false);
  const [scheduled, setScheduled] = useState("");
  const [confirm, setConfirm] = useState(false);

  const [folderName, setFolderName] = useState("");
  const [modelName, setModelName] = useState("");
  const [modelFolderId, setModelFolderId] = useState("");
  const [modelKind, setModelKind] = useState<MessageKind>("texto");
  const [modelText, setModelText] = useState("");
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [editingModelId, setEditingModelId] = useState("");
  const [editingFolderId, setEditingFolderId] = useState("");
  const [editingFolderName, setEditingFolderName] = useState("");

  async function loadGroups() {
    const data = await fetch("/api/whatsapp/groups").then((r) => r.json());
    setGroups(data.groups || data || []);
  }

  async function loadCampaigns() {
    const data = await fetch("/api/campanhas").then((r) => r.json());
    setCampaigns(Array.isArray(data) ? data : []);
  }

  async function loadPastas() {
    const data = await fetch("/api/modelos/pastas").then((r) => r.json());
    setPastas(Array.isArray(data) ? data : []);
  }

  async function loadModelos() {
    const data = await fetch("/api/modelos").then((r) => r.json());
    setModelos(Array.isArray(data) ? data : []);
  }

  async function loadAll() {
    await Promise.all([loadGroups(), loadCampaigns(), loadPastas(), loadModelos()]);
  }

  useEffect(() => { loadAll(); }, []);

  const selectedCampaign = useMemo(() => campaigns.find((campaign) => campaign.id === selectedCampaignId), [campaigns, selectedCampaignId]);
  const selectedCampaignGroups = selectedCampaign?.grupos || [];
  const selectedCampaignJids = selectedCampaignGroups.map((group) => group.group_jid);
  const campaignFilteredGroups = useMemo(() => groups.filter((group) => {
    const text = `${group.nome || ""} ${group.group_jid}`.toLowerCase();
    return text.includes(campaignGroupQuery.toLowerCase());
  }), [groups, campaignGroupQuery]);
  const modelosByFolder = useMemo(() => {
    const grouped = new Map<string, Modelo[]>();
    modelos.forEach((modelo) => {
      const key = modelo.pasta_id || "";
      grouped.set(key, [...(grouped.get(key) || []), modelo]);
    });
    return grouped;
  }, [modelos]);

  function showError(error: any) {
    setToast(error?.message || "Algo deu errado.");
  }

  function toggleNewCampaignGroup(jid: string, checked: boolean) {
    setNewCampaignGroups((current) => checked ? Array.from(new Set([...current, jid])) : current.filter((item) => item !== jid));
  }

  async function createCampaign() {
    const response = await fetch("/api/campanhas", {
      method: "POST",
      body: JSON.stringify({ nome: campaignName, group_jids: newCampaignGroups })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao criar campanha.");
    setCampaignName("");
    setNewCampaignGroups([]);
    setCreateCampaignOpen(false);
    setToast("Campanha criada.");
    await loadCampaigns();
  }

  async function updateCampaignGroups(campaign: Campanha, groupJids: string[]) {
    const response = await fetch("/api/campanhas", {
      method: "PATCH",
      body: JSON.stringify({ id: campaign.id, group_jids: Array.from(new Set(groupJids)) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao atualizar campanha.");
    await loadCampaigns();
  }

  function toggleGroupToAdd(campaignId: string, jid: string, checked: boolean) {
    setAddGroupsByCampaign((current) => {
      const list = current[campaignId] || [];
      const next = checked ? Array.from(new Set([...list, jid])) : list.filter((item) => item !== jid);
      return { ...current, [campaignId]: next };
    });
  }

  async function addGroupsToCampaign(campaign: Campanha) {
    const jids = addGroupsByCampaign[campaign.id] || [];
    if (!jids.length) return;
    await updateCampaignGroups(campaign, [...campaign.grupos.map((group) => group.group_jid), ...jids]);
    setAddGroupsByCampaign((current) => ({ ...current, [campaign.id]: [] }));
    setToast("Grupos adicionados.");
  }

  async function removeGroupFromCampaign(campaign: Campanha, jid: string) {
    await updateCampaignGroups(campaign, campaign.grupos.map((group) => group.group_jid).filter((item) => item !== jid));
    setToast("Grupo removido da campanha.");
  }

  async function deleteCampaign(campaignId: string) {
    const response = await fetch("/api/campanhas", { method: "DELETE", body: JSON.stringify({ id: campaignId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao excluir campanha.");
    if (selectedCampaignId === campaignId) applyCampaign("");
    setToast("Campanha excluída.");
    await loadCampaigns();
  }

  function applyCampaign(campaignId: string) {
    setSelectedCampaignId(campaignId);
    const campaign = campaigns.find((item) => item.id === campaignId);
    const jids = campaign?.grupos.map((group) => group.group_jid) || [];
    setCampaignTarget("all");
    setSingleGroup(jids[0] || "");
    setManualGroups(jids);
    setSelected(jids);
  }

  function changeCampaignTarget(target: CampaignTarget) {
    setCampaignTarget(target);
    if (target === "all") setSelected(selectedCampaignJids);
    if (target === "single") setSelected(singleGroup ? [singleGroup] : selectedCampaignJids.slice(0, 1));
    if (target === "manual") setSelected(manualGroups);
  }

  function changeSingleGroup(jid: string) {
    setSingleGroup(jid);
    setSelected(jid ? [jid] : []);
  }

  function toggleManualGroup(jid: string, checked: boolean) {
    setManualGroups((current) => {
      const next = checked ? Array.from(new Set([...current, jid])) : current.filter((item) => item !== jid);
      setSelected(next);
      return next;
    });
  }

  async function uploadMedia(uploadFile: File, kind: MessageKind) {
    if (kind === "texto") return null;
    const signed = await fetch("/api/upload/signed-url", {
      method: "POST",
      body: JSON.stringify({ tipo: kind, file_name: uploadFile.name, mime_type: uploadFile.type, file_size_bytes: uploadFile.size })
    }).then((r) => r.json());
    if (signed.error) throw new Error(signed.error);
    await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": uploadFile.type }, body: uploadFile });
    await fetch("/api/upload/confirm", { method: "POST", body: JSON.stringify({ storage_path: signed.storage_path }) });
    return { bucket: signed.bucket, storage_path: signed.storage_path, file_name: uploadFile.name, mime_type: uploadFile.type, file_size_bytes: uploadFile.size };
  }

  async function createLote() {
    const selectedModelo = modelos.find((modelo) => modelo.id === selectedModeloId);
    const activeTipo = messageSource === "modelo" && selectedModelo ? selectedModelo.tipo : tipo;
    const activeText = messageSource === "modelo" && selectedModelo ? selectedModelo.texto || "" : texto;
    let media = null;

    if (messageSource === "modelo" && selectedModelo?.media_bucket && selectedModelo.media_path) {
      media = {
        bucket: selectedModelo.media_bucket,
        storage_path: selectedModelo.media_path,
        file_name: selectedModelo.file_name || "arquivo",
        mime_type: selectedModelo.mime_type || "application/octet-stream",
        file_size_bytes: Number(selectedModelo.file_size_bytes || 1)
      };
    } else if (file && activeTipo !== "texto") {
      media = await uploadMedia(file, activeTipo);
    }
    if (activeTipo !== "texto" && !media) throw new Error("Selecione um arquivo para este tipo de mensagem.");

    const response = await fetch("/api/lotes/create", {
      method: "POST",
      body: JSON.stringify({
        titulo: `Lote ${new Date().toLocaleString()}`,
        group_jids: selected,
        tipo: activeTipo,
        texto: activeText,
        legenda: activeTipo === "imagem" || activeTipo === "video" ? activeText : undefined,
        mention_all: mentionAll,
        scheduled_at: scheduled ? new Date(scheduled).toISOString() : undefined,
        media
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao criar lote.");
    setConfirm(false);
    setToast("Lote criado.");
  }

  function startEditModel(modelo: Modelo) {
    setEditingModelId(modelo.id);
    setModelName(modelo.nome);
    setModelFolderId(modelo.pasta_id || "");
    setModelKind(modelo.tipo);
    setModelText(modelo.texto || "");
    setModelFile(null);
  }

  function resetModelForm() {
    setEditingModelId("");
    setModelName("");
    setModelFolderId("");
    setModelKind("texto");
    setModelText("");
    setModelFile(null);
  }

  async function saveFolder() {
    const method = editingFolderId ? "PATCH" : "POST";
    const response = await fetch("/api/modelos/pastas", {
      method,
      body: JSON.stringify({ id: editingFolderId || undefined, nome: editingFolderId ? editingFolderName : folderName })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao salvar pasta.");
    setFolderName("");
    setEditingFolderId("");
    setEditingFolderName("");
    setToast("Pasta salva.");
    await loadPastas();
  }

  async function deleteFolder(id: string) {
    const response = await fetch("/api/modelos/pastas", { method: "DELETE", body: JSON.stringify({ id }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao excluir pasta.");
    setToast("Pasta excluída.");
    await Promise.all([loadPastas(), loadModelos()]);
  }

  async function saveModel() {
    const previous = modelos.find((modelo) => modelo.id === editingModelId);
    if (modelKind !== "texto" && !modelFile && !previous?.media_bucket) throw new Error("Selecione um arquivo para este modelo.");
    const media = modelFile ? await uploadMedia(modelFile, modelKind) : previous?.media_bucket && previous.media_path && modelKind !== "texto" ? {
      bucket: previous.media_bucket,
      storage_path: previous.media_path,
      file_name: previous.file_name || "arquivo",
      mime_type: previous.mime_type || "application/octet-stream",
      file_size_bytes: Number(previous.file_size_bytes || 1)
    } : null;
    const response = await fetch("/api/modelos", {
      method: editingModelId ? "PATCH" : "POST",
      body: JSON.stringify({ id: editingModelId || undefined, pasta_id: modelFolderId || null, nome: modelName, tipo: modelKind, texto: modelText, media })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao salvar modelo.");
    resetModelForm();
    setToast("Modelo salvo.");
    await loadModelos();
  }

  async function deleteModel(id: string) {
    const response = await fetch("/api/modelos", { method: "DELETE", body: JSON.stringify({ id }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao excluir modelo.");
    setToast("Modelo excluído.");
    await loadModelos();
  }

  return <AppShell title="Grupos" subtitle="Campanhas e disparos para grupos próprios">
    <div className="mb-5 flex flex-wrap gap-2">
      <button onClick={() => setTab("campanhas")} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === "campanhas" ? "bg-accent text-white" : "border border-line bg-panel text-muted"}`}>Grupos e Campanhas</button>
      <button onClick={() => setTab("disparo")} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === "disparo" ? "bg-accent text-white" : "border border-line bg-panel text-muted"}`}>Disparo de Mensagens</button>
    </div>

    {tab === "campanhas" ? <div className="space-y-5">
      <div className="rounded-lg border border-line bg-panel p-4 shadow-soft">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="text-sm font-medium text-ink">Pesquisar grupos</label>
            <input value={campaignGroupQuery} onChange={(e) => setCampaignGroupQuery(e.target.value)} placeholder="Buscar por nome ou JID" className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3 text-sm" />
          </div>
          <ActionButton icon={<RefreshCw size={16} />} className="border border-line bg-panel text-ink" onClick={() => loadGroups().catch(showError)}>Atualizar grupos</ActionButton>
          <ActionButton icon={<FolderPlus size={16} />} disabled={!newCampaignGroups.length} onClick={() => setCreateCampaignOpen(true)}>Criar nova campanha</ActionButton>
        </div>
        <div className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-line p-3">
          {campaignFilteredGroups.map((group) => <label key={group.group_jid} className="flex items-start gap-2 py-1 text-sm">
            <input type="checkbox" className="mt-1" checked={newCampaignGroups.includes(group.group_jid)} onChange={(e) => toggleNewCampaignGroup(group.group_jid, e.target.checked)} />
            <span>{group.nome || group.group_jid}</span>
          </label>)}
          {!campaignFilteredGroups.length ? <div className="py-4 text-center text-sm text-muted">Nenhum grupo encontrado.</div> : null}
        </div>
        <div className="mt-3 text-sm text-muted">{newCampaignGroups.length} grupo(s) selecionado(s) para a nova campanha.</div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        {campaigns.map((campaign) => {
          const availableGroups = groups.filter((group) => !campaign.grupos.some((item) => item.group_jid === group.group_jid));
          const addSelection = addGroupsByCampaign[campaign.id] || [];
          return <section key={campaign.id} className="min-w-80 rounded-lg border border-line bg-panel p-4 shadow-soft">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-ink">{campaign.nome}</h2>
                <div className="text-sm text-muted">{campaign.grupos.length} grupo(s)</div>
              </div>
              <button title="Excluir campanha" className="rounded-lg p-1 text-muted hover:bg-wash hover:text-ink" onClick={() => deleteCampaign(campaign.id).catch(showError)}><Trash2 size={16} /></button>
            </div>
            <div className="space-y-2">
              {campaign.grupos.length ? campaign.grupos.map((group) => <div key={group.group_jid} className="flex items-start justify-between gap-2 rounded-lg border border-line bg-wash p-3 text-sm">
                <div>
                  <div className="font-medium text-ink">{group.nome || "Sem nome"}</div>
                  <div className="mt-1 font-mono text-xs text-muted">{group.group_jid}</div>
                </div>
                <button title="Remover grupo" className="rounded-lg p-1 text-muted hover:bg-panel hover:text-ink" onClick={() => removeGroupFromCampaign(campaign, group.group_jid).catch(showError)}><X size={15} /></button>
              </div>) : <div className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">Nenhum grupo vinculado.</div>}
            </div>
            <div className="mt-4 rounded-lg border border-line p-3">
              <div className="mb-2 text-sm font-medium text-ink">Adicionar grupos</div>
              <div className="max-h-40 space-y-2 overflow-y-auto">
                {availableGroups.map((group) => <label key={group.group_jid} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={addSelection.includes(group.group_jid)} onChange={(e) => toggleGroupToAdd(campaign.id, group.group_jid, e.target.checked)} />
                  <span>{group.nome || group.group_jid}</span>
                </label>)}
                {!availableGroups.length ? <div className="text-sm text-muted">Todos os grupos já estão nesta campanha.</div> : null}
              </div>
              <button className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-white disabled:opacity-50" disabled={!addSelection.length} onClick={() => addGroupsToCampaign(campaign).catch(showError)}><Plus size={16} />Adicionar selecionados</button>
            </div>
          </section>;
        })}
        {!campaigns.length ? <div className="w-full rounded-lg border border-dashed border-line bg-panel p-8 text-center text-muted">Crie a primeira campanha para organizar seus grupos.</div> : null}
      </div>
    </div> : null}

    {tab === "disparo" ? <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <section className="space-y-4">
        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold">Destino</h2>
          <select value={selectedCampaignId} onChange={(e) => applyCampaign(e.target.value)} className="focus-ring mt-4 h-11 w-full rounded-lg border border-line px-3 text-sm">
            <option value="">Selecionar campanha</option>
            {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.nome} ({campaign.grupos.length})</option>)}
          </select>
          {selectedCampaign ? <div className="mt-4 space-y-3">
            <select value={campaignTarget} onChange={(e) => changeCampaignTarget(e.target.value as CampaignTarget)} className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm">
              <option value="all">Todos os grupos da campanha</option>
              <option value="single">Um grupo específico</option>
              <option value="manual">Selecionar alguns grupos</option>
            </select>
            {campaignTarget === "single" ? <select value={singleGroup} onChange={(e) => changeSingleGroup(e.target.value)} className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm">
              {selectedCampaignGroups.map((group) => <option key={group.group_jid} value={group.group_jid}>{group.nome || group.group_jid}</option>)}
            </select> : null}
            {campaignTarget === "manual" ? <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-line p-3">
              {selectedCampaignGroups.map((group) => <label key={group.group_jid} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={manualGroups.includes(group.group_jid)} onChange={(e) => toggleManualGroup(group.group_jid, e.target.checked)} />
                <span>{group.nome || group.group_jid}</span>
              </label>)}
            </div> : null}
            <div className="text-sm text-muted">{selected.length} grupo(s) selecionado(s) para envio.</div>
          </div> : null}
        </div>

        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold">Mensagem</h2>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={() => setMessageSource("manual")} className={`rounded-lg px-3 py-2 text-sm ${messageSource === "manual" ? "bg-accent text-white" : "border border-line text-muted"}`}>Manual</button>
            <button onClick={() => setMessageSource("modelo")} className={`rounded-lg px-3 py-2 text-sm ${messageSource === "modelo" ? "bg-accent text-white" : "border border-line text-muted"}`}>Modelo pronto</button>
          </div>

          {messageSource === "manual" ? <div className="mt-4 space-y-3">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as MessageKind)} className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm">
              {Object.entries(messageKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {(tipo === "texto" || tipo === "imagem" || tipo === "video") ? <textarea placeholder="Mensagem" value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} className="focus-ring w-full rounded-lg border border-line p-3 text-sm" /> : null}
            {tipo !== "texto" ? <><FileDropzone onFile={setFile} /><MediaPreview fileName={file?.name} mimeType={file?.type} /></> : null}
          </div> : <div className="mt-4 space-y-3">
            <select value={selectedModeloId} onChange={(e) => setSelectedModeloId(e.target.value)} className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm">
              <option value="">Selecionar modelo</option>
              {modelos.map((modelo) => <option key={modelo.id} value={modelo.id}>{modelo.nome} - {messageKindLabels[modelo.tipo]}</option>)}
            </select>
          </div>}

          <div className="mt-3"><DateTimePicker value={scheduled} onChange={(e) => setScheduled(e.target.value)} /></div>
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-wash p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={mentionAll} onChange={(e) => setMentionAll(e.target.checked)} />
            <span>
              <span className="block font-medium text-ink">Mencionar todos os participantes</span>
              <span className="block text-muted">Quando ativado, cada grupo do disparo recebe a mensagem mencionando seus membros.</span>
            </span>
          </label>
          <ActionButton icon={<Send size={16} />} disabled={!selected.length || (messageSource === "modelo" && !selectedModeloId)} onClick={() => setConfirm(true)} className="mt-4 w-full bg-accent text-white">Enviar ou agendar</ActionButton>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold">Pastas de modelos</h2>
          <div className="mt-4 flex gap-2">
            <input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Nova pasta" className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm" />
            <button className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-white disabled:opacity-50" disabled={!folderName.trim()} onClick={() => saveFolder().catch(showError)} title="Criar pasta"><FolderPlus size={17} /></button>
          </div>
          <div className="mt-4 space-y-2">
            {pastas.map((pasta) => <div key={pasta.id} className="rounded-lg border border-line p-3">
              {editingFolderId === pasta.id ? <div className="flex gap-2">
                <input value={editingFolderName} onChange={(e) => setEditingFolderName(e.target.value)} className="focus-ring h-9 min-w-0 flex-1 rounded-lg border border-line px-2 text-sm" />
                <button className="rounded-lg bg-accent px-3 text-white" onClick={() => saveFolder().catch(showError)}><Save size={15} /></button>
              </div> : <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{pasta.nome}</span>
                <div className="flex gap-1">
                  <button className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-wash" onClick={() => { setEditingFolderId(pasta.id); setEditingFolderName(pasta.nome); }}>Editar</button>
                  <button className="rounded-lg p-1 text-muted hover:bg-wash hover:text-ink" onClick={() => deleteFolder(pasta.id).catch(showError)}><Trash2 size={15} /></button>
                </div>
              </div>}
            </div>)}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold">{editingModelId ? "Editar modelo" : "Novo modelo"}</h2>
          <div className="mt-4 space-y-3">
            <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Nome do modelo" className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm" />
            <select value={modelFolderId} onChange={(e) => setModelFolderId(e.target.value)} className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm">
              <option value="">Sem pasta</option>
              {pastas.map((pasta) => <option key={pasta.id} value={pasta.id}>{pasta.nome}</option>)}
            </select>
            <select value={modelKind} onChange={(e) => setModelKind(e.target.value as MessageKind)} className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm">
              {Object.entries(messageKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {(modelKind === "texto" || modelKind === "imagem" || modelKind === "video") ? <textarea value={modelText} onChange={(e) => setModelText(e.target.value)} placeholder="Texto do modelo" rows={4} className="focus-ring w-full rounded-lg border border-line p-3 text-sm" /> : null}
            {modelKind !== "texto" ? <><FileDropzone onFile={setModelFile} /><MediaPreview fileName={modelFile?.name} mimeType={modelFile?.type} /></> : null}
            <div className="flex gap-2">
              <ActionButton icon={<Save size={16} />} disabled={!modelName.trim()} onClick={() => saveModel().catch(showError)} className="flex-1 bg-accent text-white">Salvar modelo</ActionButton>
              {editingModelId ? <ActionButton icon={<X size={16} />} onClick={resetModelForm} className="border border-line bg-panel text-ink">Cancelar</ActionButton> : null}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold">Modelos salvos</h2>
          <div className="mt-4 space-y-4">
            {[{ id: "", nome: "Sem pasta" }, ...pastas].map((pasta) => {
              const items = modelosByFolder.get(pasta.id) || [];
              if (!items.length) return null;
              return <section key={pasta.id || "sem-pasta"}>
                <h3 className="mb-2 text-sm font-medium text-muted">{pasta.nome}</h3>
                <div className="space-y-2">
                  {items.map((modelo) => <div key={modelo.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-ink">{modelo.nome}</div>
                        <div className="mt-1 text-xs text-muted">{messageKindLabels[modelo.tipo]}</div>
                      </div>
                      <div className="flex gap-1">
                        <button className="rounded-lg p-1 text-muted hover:bg-wash hover:text-ink" onClick={() => startEditModel(modelo)}><FileText size={15} /></button>
                        <button className="rounded-lg p-1 text-muted hover:bg-wash hover:text-ink" onClick={() => deleteModel(modelo.id).catch(showError)}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  </div>)}
                </div>
              </section>;
            })}
          </div>
        </div>
      </aside>
    </div> : null}

    <ConfirmModal open={createCampaignOpen} title="Criar campanha" onCancel={() => setCreateCampaignOpen(false)} onConfirm={() => createCampaign().catch(showError)}>
      <div className="space-y-3">
        <div>Informe o nome da campanha para os {newCampaignGroups.length} grupo(s) selecionado(s).</div>
        <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Nome da campanha" className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm" />
      </div>
    </ConfirmModal>
    <ConfirmModal open={confirm} title="Confirmar disparo" onCancel={() => setConfirm(false)} onConfirm={() => createLote().catch(showError)}>Serão criados {selected.length} itens para a campanha selecionada.</ConfirmModal>
    <Toast message={toast} />
  </AppShell>;
}
