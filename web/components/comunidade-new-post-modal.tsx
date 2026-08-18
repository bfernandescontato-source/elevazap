"use client";

import { useState } from "react";
import { Image as ImageIcon, Loader2, X } from "lucide-react";
import { communityCategories, communityMarketplaces } from "@/modules/comunidade/schemas";
import { CATEGORY_LABELS, MARKETPLACE_LABELS } from "@/modules/comunidade/constants";
import type { CommunityPost } from "@/modules/comunidade/types";

export function ComunidadeNewPostModal({ onClose, onCreated }: { onClose: () => void; onCreated: (post: CommunityPost) => void }) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<typeof communityCategories[number]>("geral");
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [resultAmount, setResultAmount] = useState("");
  const [resultMarketplace, setResultMarketplace] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [error, setError] = useState("");

  const addImages = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files).slice(0, 4 - images.length).map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setImages((current) => [...current, ...next].slice(0, 4));
  };
  const removeImage = (index: number) => setImages((current) => current.filter((_, i) => i !== index));

  const uploadImage = async (file: File) => {
    const response = await fetch("/api/comunidade/upload/signed-url", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_name: file.name, mime_type: file.type, file_size_bytes: file.size })
    });
    const signed = await response.json();
    if (!response.ok) throw new Error(signed.error || "Falha ao preparar imagem.");
    await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
    await fetch("/api/comunidade/upload/confirm", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storage_path: signed.storage_path })
    });
    return signed.storage_path as string;
  };

  const submit = async () => {
    if (!content.trim()) return;
    setLoading(true); setError("");
    try {
      setUploadingCount(images.length);
      const image_paths: string[] = [];
      for (const image of images) { image_paths.push(await uploadImage(image.file)); setUploadingCount((count) => count - 1); }
      const body: Record<string, unknown> = { content: content.trim(), category, image_paths };
      if (category === "resultado") {
        if (resultAmount) body.result_amount_cents = Math.round(Number(resultAmount.replace(",", ".")) * 100);
        if (resultMarketplace) body.result_marketplace = resultMarketplace;
      }
      const response = await fetch("/api/comunidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível publicar.");
      onCreated(result.post);
      onClose();
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível publicar.");
    } finally { setLoading(false); }
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
    <div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-panel p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-ink">Nova publicação</h3>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-wash"><X size={16} /></button>
      </div>
      <textarea autoFocus value={content} onChange={(event) => setContent(event.target.value)} maxLength={5000} rows={5}
        placeholder="O que você quer compartilhar?" className="focus-ring mt-4 w-full resize-none rounded-lg border border-line bg-white p-3 text-sm" />
      <div className="mt-3 flex flex-wrap gap-2">
        {communityCategories.map((value) => <button key={value} type="button" onClick={() => setCategory(value)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${category === value ? "border-black bg-black text-white" : "border-line bg-white text-muted"}`}>{CATEGORY_LABELS[value]}</button>)}
      </div>
      {category === "resultado" ? <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-line bg-wash p-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">Resultado (R$)</label>
          <input value={resultAmount} onChange={(event) => setResultAmount(event.target.value)} placeholder="1250,00" className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">Marketplace</label>
          <select value={resultMarketplace} onChange={(event) => setResultMarketplace(event.target.value)} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm">
            <option value="">Selecionar</option>
            {communityMarketplaces.map((value) => <option key={value} value={value}>{MARKETPLACE_LABELS[value]}</option>)}
          </select>
        </div>
      </div> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {images.map((image, index) => <div key={index} className="relative h-20 w-20 overflow-hidden rounded-lg border border-line">
          <img src={image.preview} alt="" className="h-full w-full object-cover" />
          <button type="button" onClick={() => removeImage(index)} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white"><X size={12} /></button>
        </div>)}
        {images.length < 4 ? <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-lg border border-dashed border-line bg-wash text-muted hover:bg-white">
          <ImageIcon size={20} />
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => addImages(event.target.files)} />
        </label> : null}
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={loading} className="rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50" onClick={onClose}>Cancelar</button>
        <button type="button" disabled={loading || !content.trim()} className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50" onClick={submit}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : null} {loading && uploadingCount > 0 ? `Enviando imagem (${uploadingCount})...` : "Publicar"}
        </button>
      </div>
    </div>
  </div>;
}
