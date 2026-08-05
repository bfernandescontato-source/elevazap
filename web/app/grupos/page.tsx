"use client";

import { ActionButton, AppShell, ConfirmModal, DateTimePicker, FileDropzone, MediaPreview, Toast } from "@/components/ui";
import { ScheduledDispatches } from "@/components/scheduled-dispatches";
import { FolderPlus, Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
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
  whatsapp_sender_id?: string | null;
  numero?: { id: string; label: string; session_name: string } | null;
  grupos: Grupo[];
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

type Sender = {
  id: string;
  label: string;
  session_name: string;
  status?: string;
  qr?: string;
};

type Tab = "campanhas" | "disparo";
type CampaignTarget = "all" | "single" | "manual";
type MessageSource = "manual" | "modelo";
type MessageKind = "texto" | "imagem" | "video" | "audio" | "documento";
type DispatchSection = "novo" | "programados";

const messageKindLabels: Record<MessageKind, string> = {
  texto: "Apenas texto",
  imagem: "Texto + imagem",
  video: "Texto + vídeo",
  audio: "Áudio",
  documento: "Documento"
};

function formatScheduledInput(value: string) {
  if (!value) return "Envio imediato";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

export default function GruposPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const initialTab: Tab = searchParams?.tab === "disparo" ? "disparo" : "campanhas";
  const [tab] = useState<Tab>(initialTab);
  const [groups, setGroups] = useState<Grupo[]>([]);
  const [campaigns, setCampaigns] = useState<Campanha[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [toast, setToast] = useState("");

  const [campaignName, setCampaignName] = useState("");
  const [campaignSenderId, setCampaignSenderId] = useState("");
  const [campaignGroupQuery, setCampaignGroupQuery] = useState("");
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false);
  const [newCampaignGroups, setNewCampaignGroups] = useState<string[]>([]);
  const [addGroupsByCampaign, setAddGroupsByCampaign] = useState<Record<string, string[]>>({});
  const [groupQueryByCampaign, setGroupQueryByCampaign] = useState<Record<string, string>>({});

  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [selectedSenderId, setSelectedSenderId] = useState("");
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
  const [dispatchSection, setDispatchSection] = useState<DispatchSection>("novo");

  async function loadGroups(senderId = "") {
    const data = await fetch(`/api/whatsapp/groups${senderId ? `?sender_id=${senderId}` : ""}`).then((r) => r.json());
    setGroups(Array.isArray(data) ? data : data.groups || []);
  }

  async function refreshGroupsFromWhatsApp() {
    const endpoint = campaignSenderId
      ? `/api/whatsapp/senders/${campaignSenderId}/refresh-groups`
      : "/api/whatsapp/groups/refresh";
    const res = await fetch(endpoint, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao atualizar grupos.");
    await loadGroups(campaignSenderId);
  }

  async function loadCampaigns() {
    const data = await fetch("/api/campanhas").then((r) => r.json());
    setCampaigns(Array.isArray(data) ? data : []);
  }

  async function loadModelos() {
    const data = await fetch("/api/modelos").then((r) => r.json());
    setModelos(Array.isArray(data) ? data : []);
  }

  async function loadSenders() {
    const data = await fetch("/api/whatsapp/senders").then((r) => r.json());
    setSenders(data.senders || []);
  }

  async function loadAll() {
    await Promise.all([loadGroups(), loadCampaigns(), loadModelos(), loadSenders()]);
  }

  // Initial loaders only depend on stable state setters and the empty sender selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadAll(); }, []);

  const selectedCampaign = useMemo(() => campaigns.find((campaign) => campaign.id === selectedCampaignId), [campaigns, selectedCampaignId]);
  const selectedSender = useMemo(() => senders.find((sender) => sender.id === selectedSenderId), [senders, selectedSenderId]);
  const selectedCampaignGroups = selectedCampaign?.grupos || [];
  const selectedCampaignJids = selectedCampaignGroups.map((group) => group.group_jid);
  const campaignFilteredGroups = useMemo(() => groups.filter((group) => {
    const text = `${group.nome || ""} ${group.group_jid}`.toLowerCase();
    return text.includes(campaignGroupQuery.toLowerCase());
  }), [groups, campaignGroupQuery]);
  function showError(error: any) {
    setToast(error?.message || "Algo deu errado.");
  }

  function toggleNewCampaignGroup(jid: string, checked: boolean) {
    setNewCampaignGroups((current) => checked ? Array.from(new Set([...current, jid])) : current.filter((item) => item !== jid));
  }

  async function createCampaign() {
    const response = await fetch("/api/campanhas", {
      method: "POST",
      body: JSON.stringify({ nome: campaignName, group_jids: newCampaignGroups, whatsapp_sender_id: campaignSenderId || null })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível criar a campanha.");
    setCampaignName("");
    setCampaignSenderId("");
    setNewCampaignGroups([]);
    setCreateCampaignOpen(false);
    setToast("Campanha criada.");
    await loadCampaigns();
  }

  async function selectCampaignSender(senderId: string) {
    setCampaignSenderId(senderId);
    setNewCampaignGroups([]);
    await loadGroups(senderId);
  }

  async function updateCampaignSender(campaign: Campanha, senderId: string) {
    const response = await fetch("/api/campanhas", { method: "PATCH", body: JSON.stringify({ id: campaign.id, whatsapp_sender_id: senderId || null }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível atualizar o número da campanha.");
    setToast("Número da campanha atualizado.");
    setCampaignSenderId(senderId);
    await loadGroups(senderId);
    await loadCampaigns();
  }

  async function renameCampaign(campaign: Campanha, nome: string) {
    const nextName = nome.trim();
    if (!nextName || nextName === campaign.nome) return;
    const response = await fetch("/api/campanhas", { method: "PATCH", body: JSON.stringify({ id: campaign.id, nome: nextName }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível renomear a campanha.");
    setToast("Nome da campanha atualizado.");
    await loadCampaigns();
  }

  async function updateCampaignGroups(campaign: Campanha, groupJids: string[]) {
    const response = await fetch("/api/campanhas", {
      method: "PATCH",
      body: JSON.stringify({ id: campaign.id, group_jids: Array.from(new Set(groupJids)) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível atualizar a campanha.");
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
    if (!response.ok) throw new Error(data.error || "Não foi possível excluir a campanha.");
    if (selectedCampaignId === campaignId) applyCampaign("");
    setToast("Lista excluída.");
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
    setSelectedSenderId(campaign?.whatsapp_sender_id || "");
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
    const campaignTitle = selectedCampaign?.nome;
    if (!campaignTitle) throw new Error("Selecione uma campanha.");
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
        titulo: campaignTitle,
        campanha_id: selectedCampaignId,
        group_jids: selected,
        whatsapp_sender_id: selectedSenderId || selectedCampaign?.whatsapp_sender_id || undefined,
        tipo: activeTipo,
        texto: activeText,
        legenda: activeTipo === "imagem" || activeTipo === "video" ? activeText : undefined,
        mention_all: mentionAll,
        scheduled_at: scheduled ? new Date(scheduled).toISOString() : undefined,
        media
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível criar a campanha.");
    setConfirm(false);
    setToast("Disparo criado.");
    setDispatchSection("programados");
  }

  return <AppShell title={tab === "campanhas" ? "Campanhas" : "Disparos"} subtitle={tab === "campanhas" ? "Organize números e grupos por campanha" : "Escolha a campanha, a mensagem e o momento do envio"}>

    {tab === "campanhas" ? <div className="space-y-5">
      <div className="rounded-lg border border-line bg-panel p-4 shadow-soft">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="lg:w-72">
            <label className="text-sm font-medium text-ink">Número conectado</label>
            <select value={campaignSenderId} onChange={(e) => selectCampaignSender(e.target.value).catch(showError)} className="focus-ring mt-1 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm">
              <option value="">Número principal</option>
              {senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium text-ink">Pesquisar grupos</label>
            <input value={campaignGroupQuery} onChange={(e) => setCampaignGroupQuery(e.target.value)} placeholder="Pesquisar grupos deste número" className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3 text-sm" />
          </div>
          <ActionButton icon={<RefreshCw size={16} />} className="border border-line bg-panel text-ink" onClick={() => refreshGroupsFromWhatsApp().catch(showError)}>Atualizar grupos</ActionButton>
          <ActionButton icon={<FolderPlus size={16} />} disabled={!newCampaignGroups.length} onClick={() => setCreateCampaignOpen(true)}>Criar campanha</ActionButton>
        </div>
        <div className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-line p-3">
          {campaignFilteredGroups.map((group) => <label key={group.group_jid} className="flex items-start gap-2 py-1 text-sm">
            <input type="checkbox" className="mt-1" checked={newCampaignGroups.includes(group.group_jid)} onChange={(e) => toggleNewCampaignGroup(group.group_jid, e.target.checked)} />
            <span>{group.nome || group.group_jid}</span>
          </label>)}
          {!campaignFilteredGroups.length ? <div className="py-4 text-center text-sm text-muted">Nenhum grupo encontrado.</div> : null}
        </div>
        <div className="mt-3 text-sm text-muted">{newCampaignGroups.length} grupo(s) selecionado(s) para a nova campanha.</div>
        {newCampaignGroups.length ? <div className="mt-3 flex flex-wrap gap-2">
          {newCampaignGroups.map((jid) => {
            const group = groups.find((item) => item.group_jid === jid);
            return <button key={jid} type="button" title="Remover da seleção" onClick={() => toggleNewCampaignGroup(jid, false)} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-wash px-3 py-2 text-left text-xs text-ink">
              <span className="truncate">{group?.nome || jid}</span><X size={14} className="shrink-0" />
            </button>;
          })}
        </div> : null}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        {campaigns.map((campaign) => {
          const groupQuery = groupQueryByCampaign[campaign.id] || "";
          const availableGroups = groups.filter((group) => !campaign.grupos.some((item) => item.group_jid === group.group_jid))
            .filter((group) => `${group.nome || ""} ${group.group_jid}`.toLowerCase().includes(groupQuery.toLowerCase()));
          const addSelection = addGroupsByCampaign[campaign.id] || [];
          return <section key={campaign.id} className="min-w-80 rounded-lg border border-line bg-panel p-4 shadow-soft">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <input aria-label="Nome da campanha" defaultValue={campaign.nome} onBlur={(event) => renameCampaign(campaign, event.target.value).catch(showError)} className="focus-ring w-full rounded-lg border border-transparent bg-transparent px-1 py-1 font-semibold text-ink hover:border-line focus:border-line" />
                <div className="text-sm text-muted">{campaign.numero?.label || "Número principal"} · {campaign.grupos.length} grupo(s)</div>
              </div>
              <button title="Excluir campanha" className="rounded-lg p-1 text-muted hover:bg-wash hover:text-ink" onClick={() => deleteCampaign(campaign.id).catch(showError)}><Trash2 size={16} /></button>
            </div>
            <label className="mt-4 block text-sm font-medium text-ink">Número responsável
              <select value={campaign.whatsapp_sender_id || ""} onChange={(e) => updateCampaignSender(campaign, e.target.value).catch(showError)} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm">
                <option value="">Número principal</option>
                {senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label}</option>)}
              </select>
            </label>
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
              <input value={groupQuery} onChange={(event) => setGroupQueryByCampaign((current) => ({ ...current, [campaign.id]: event.target.value }))} placeholder="Pesquisar grupos" className="focus-ring mb-3 h-10 w-full rounded-lg border border-line px-3 text-sm" />
              <div className="max-h-40 space-y-2 overflow-y-auto">
                {availableGroups.map((group) => <label key={group.group_jid} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={addSelection.includes(group.group_jid)} onChange={(e) => toggleGroupToAdd(campaign.id, group.group_jid, e.target.checked)} />
                  <span>{group.nome || group.group_jid}</span>
                </label>)}
                {!availableGroups.length ? <div className="text-sm text-muted">Nenhum outro grupo disponível.</div> : null}
              </div>
              <button className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-white disabled:opacity-50" disabled={!addSelection.length} onClick={() => addGroupsToCampaign(campaign).catch(showError)}><Plus size={16} />Adicionar selecionados</button>
            </div>
          </section>;
        })}
        {!campaigns.length ? <div className="w-full rounded-lg border border-dashed border-line bg-panel p-8 text-center text-muted">Crie a primeira campanha escolhendo um número e seus grupos.</div> : null}
      </div>
    </div> : null}

    {tab === "disparo" ? <div className="mb-6 flex gap-2 border-b border-line pb-3" role="tablist" aria-label="Áreas de disparos">
      <button type="button" role="tab" aria-selected={dispatchSection === "novo"} onClick={() => setDispatchSection("novo")} className={`h-10 rounded-lg px-4 text-sm font-medium ${dispatchSection === "novo" ? "bg-black text-white" : "border border-line bg-white text-muted hover:text-ink"}`}>Novo disparo</button>
      <button type="button" role="tab" aria-selected={dispatchSection === "programados"} onClick={() => setDispatchSection("programados")} className={`h-10 rounded-lg px-4 text-sm font-medium ${dispatchSection === "programados" ? "bg-black text-white" : "border border-line bg-white text-muted hover:text-ink"}`}>Programados</button>
    </div> : null}

    {tab === "disparo" && dispatchSection === "novo" ? <div className="max-w-4xl">
      <section className="space-y-4">
        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold">1. Escolher campanha</h2>
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
          <h2 className="font-semibold">2. Escolher telefone responsável</h2>
          <select value={selectedSenderId} onChange={(e) => setSelectedSenderId(e.target.value)} className="focus-ring mt-4 h-11 w-full rounded-lg border border-line px-3 text-sm">
            <option value="">Número principal conectado</option>
            {senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label} ({sender.status || "desconectado"})</option>)}
          </select>
          <div className="mt-2 text-sm text-muted">{selectedSender ? `Este disparo será feito pelo número "${selectedSender.label}".` : "Sem seleção extra: usa o número principal de Números conectados."}</div>
        </div>

        <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold">3. Escolher ou escrever mensagem</h2>
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

          <div className="mt-4">
            <label className="text-sm font-medium text-ink">Data e horário do disparo</label>
            <DateTimePicker value={scheduled} onChange={(e) => setScheduled(e.target.value)} className="focus-ring mt-1 h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm" />
            <div className="mt-2 text-sm text-muted">{scheduled ? `Programado para ${formatScheduledInput(scheduled)} (horário de Brasília).` : "Deixe vazio para enviar imediatamente."}</div>
          </div>
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-wash p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={mentionAll} onChange={(e) => setMentionAll(e.target.checked)} />
            <span>
              <span className="block font-medium text-ink">Mencionar todos os participantes</span>
              <span className="block text-muted">Quando ativado, cada grupo do disparo recebe a mensagem mencionando seus membros.</span>
            </span>
          </label>
          <ActionButton icon={<Send size={16} />} disabled={!selectedCampaignId || !selected.length || (messageSource === "modelo" && !selectedModeloId)} onClick={() => setConfirm(true)} className="mt-4 w-full bg-accent text-white">Criar disparo</ActionButton>
        </div>
      </section>

    </div> : null}

    {tab === "disparo" && dispatchSection === "programados" ? <ScheduledDispatches /> : null}

    <ConfirmModal open={createCampaignOpen} title="Criar campanha" onCancel={() => setCreateCampaignOpen(false)} onConfirm={() => createCampaign().catch(showError)}>
      <div className="space-y-3">
        <div>Informe o nome da campanha para os {newCampaignGroups.length} grupo(s) selecionado(s).</div>
        <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Ex: Promoção de sexta" className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm" />
      </div>
    </ConfirmModal>
    <ConfirmModal open={confirm} title="Confirmar disparo" onCancel={() => setConfirm(false)} onConfirm={() => createLote().catch(showError)}><div className="space-y-3"><p>A mensagem será enviada para {selected.length} grupo(s) da campanha “{selectedCampaign?.nome}”.</p><div className="rounded-lg bg-wash p-3"><div className="text-xs font-medium uppercase text-muted">Data e horário do disparo</div><div className="mt-1 font-semibold text-ink">{scheduled ? `${formatScheduledInput(scheduled)} (horário de Brasília)` : "Envio imediato"}</div></div></div></ConfirmModal>
    <Toast message={toast} />
  </AppShell>;
}
