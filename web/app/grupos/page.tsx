"use client";

import { ActionButton, AppShell, ConfirmModal, DataTable, DateTimePicker, FileDropzone, MediaPreview, SearchInput, StatusBadge, Toast } from "@/components/ui";
import { RefreshCw, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export default function GruposPage() {
  const [groups, setGroups] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [tipo, setTipo] = useState("texto");
  const [texto, setTexto] = useState("");
  const [legenda, setLegenda] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scheduled, setScheduled] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState("");
  async function load() { const data = await fetch("/api/whatsapp/groups").then((r) => r.json()); setGroups(data.groups || data || []); }
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => groups.filter((g) => (g.nome || "").toLowerCase().includes(query.toLowerCase())), [groups, query]);
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
    await fetch("/api/lotes/create", { method: "POST", body: JSON.stringify({ titulo: `Lote ${new Date().toLocaleString()}`, group_jids: selected, tipo, texto, legenda, scheduled_at: scheduled ? new Date(scheduled).toISOString() : undefined, media }) });
    setConfirm(false); setToast("Lote criado.");
  }
  return <AppShell title="Grupos" subtitle="Grupos próprios em que o número já participa">
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <section className="space-y-3">
        <div className="flex gap-2"><div className="flex-1"><SearchInput placeholder="Buscar grupo" value={query} onChange={(e) => setQuery(e.target.value)} /></div><ActionButton icon={<RefreshCw size={16} />} onClick={async () => { await fetch("/api/whatsapp/groups/refresh", { method: "POST" }); load(); }}>Atualizar</ActionButton></div>
        <DataTable columns={["", "Grupo", "Membros", "Admin", "JID"]} rows={filtered.map((g) => [<input key={g.group_jid} type="checkbox" checked={selected.includes(g.group_jid)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, g.group_jid] : s.filter((x) => x !== g.group_jid))} />, <span key="n" className="font-medium">{g.nome || "Sem nome"}</span>, g.qtd_membros || 0, <StatusBadge key="a" status={g.sou_admin ? "sucesso" : "pendente"} />, <span key="j" className="font-mono text-xs">{g.group_jid}</span>])} />
      </section>
      <aside className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <h2 className="font-semibold">Composer</h2>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="focus-ring mt-4 h-11 w-full rounded-lg border border-line px-3"><option value="texto">Texto</option><option value="imagem">Imagem</option><option value="video">Vídeo</option><option value="audio">Áudio</option><option value="audio_voz">Áudio de voz</option><option value="documento">Documento</option></select>
        <textarea placeholder="Texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} className="focus-ring mt-3 w-full rounded-lg border border-line p-3" />
        {tipo !== "texto" ? <><input placeholder="Legenda" value={legenda} onChange={(e) => setLegenda(e.target.value)} className="focus-ring mt-3 h-11 w-full rounded-lg border border-line px-3" /><div className="mt-3"><FileDropzone onFile={setFile} /></div><div className="mt-3"><MediaPreview fileName={file?.name} mimeType={file?.type} /></div></> : null}
        <div className="mt-3"><DateTimePicker value={scheduled} onChange={(e) => setScheduled(e.target.value)} /></div>
        <ActionButton icon={<Send size={16} />} disabled={!selected.length} onClick={() => setConfirm(true)} className="mt-4 w-full bg-accent text-white">Enviar ou agendar</ActionButton>
      </aside>
    </div>
    <ConfirmModal open={confirm} title="Confirmar lote" onCancel={() => setConfirm(false)} onConfirm={createLote}>Serão criados {selected.length} itens. O serviço enviará um grupo por vez, pela fila global.</ConfirmModal>
    <Toast message={toast} />
  </AppShell>;
}
