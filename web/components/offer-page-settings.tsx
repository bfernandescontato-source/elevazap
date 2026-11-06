"use client";

import { Check, Clipboard, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingState } from "@/components/ui";
import { OfferPageGrid } from "@/components/offer-page-grid";
import type { PublicOfferItem } from "@/modules/offer-page/public-mapper";
import { OFFER_PAGE_STORES, STORE_LABELS, type OfferPageStore } from "@/modules/offer-page/offer-text";
import { normalizeSlugInput, validateSlug } from "@/modules/offer-page/slug";

type Settings = { enabled: boolean; slug: string; title: string; bio: string; useProfilePhoto: boolean; stores: OfferPageStore[] };
type Loaded = { settings: Settings | null; suggestedSlug: string; suggestedTitle: string; profilePhotoUrl: string | null; items: PublicOfferItem[] };

// "Minha vitrine" (Configurações): página pública com as ofertas enviadas.
export function OfferPageSettings() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  async function load() {
    const response = await fetch("/api/vitrine", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Não foi possível carregar a vitrine.");
    setLoaded(body);
    setForm(body.settings || { enabled: false, slug: body.suggestedSlug || "", title: body.suggestedTitle || "", bio: "", useProfilePhoto: Boolean(body.profilePhotoUrl), stores: [...OFFER_PAGE_STORES] });
  }

  useEffect(() => { setOrigin(window.location.origin); load().catch((e) => setError(e.message)); }, []);

  if (!form || !loaded) return error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : <LoadingState />;

  const slugCheck = validateSlug(form.slug);
  const savedSlug = loaded.settings?.slug || "";
  const publicLink = savedSlug ? `${origin}/v/${savedSlug}` : "";
  const update = (change: Partial<Settings>) => { setForm({ ...form, ...change }); setMessage(""); setError(""); };
  const toggleStore = (store: OfferPageStore) => update({ stores: form.stores.includes(store) ? form.stores.filter((item) => item !== store) : [...form.stores, store] });

  // Carga inicial em lotes curtos: cada chamada lê até 300 envios.
  async function syncSentOffers() {
    let cursor: { beforeSentAt?: string | null; beforeId?: string | null } = {};
    let found = 0;
    for (let round = 0; round < 60; round += 1) {
      setSyncing(found ? `Buscando suas ofertas enviadas. ${found} encontradas até agora.` : "Buscando suas ofertas enviadas.");
      const response = await fetch("/api/vitrine/backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cursor) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Não foi possível buscar suas ofertas enviadas.");
      found += Number(body.recorded || 0);
      if (body.done || !body.next) break;
      cursor = body.next;
    }
    setSyncing("");
  }

  async function save() {
    if (!form || !slugCheck.ok) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/vitrine", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, slug: slugCheck.slug }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar a vitrine.");
      if (body.created) await syncSentOffers();
      await load();
      setMessage(form.enabled ? "Vitrine salva e no ar." : "Vitrine salva. Ela só aparece para o público quando estiver ligada.");
    } catch (current) {
      setSyncing("");
      setError(current instanceof Error ? current.message : "Não foi possível salvar a vitrine.");
    } finally { setSaving(false); }
  }

  async function copyLink() {
    if (!publicLink) return;
    await navigator.clipboard.writeText(publicLink).catch(() => undefined);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  const input = "focus-ring mt-1 h-11 w-full rounded-lg border border-line bg-white px-3 text-ink";
  return <section className="space-y-5">
    <div className="max-w-2xl rounded-lg border border-line bg-panel p-4 shadow-soft sm:p-6">
      <h2 className="text-lg font-semibold text-ink">Minha vitrine</h2>
      <p className="mt-1 text-sm text-muted">Uma página com as ofertas que você enviou nos últimos 30 dias. Coloque o link na bio do Instagram. Cada oferta enviada entra sozinha.</p>

      <label className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-line bg-wash p-4">
        <span><span className="block text-sm font-medium text-ink">Vitrine ligada</span><span className="block text-xs text-muted">Desligada, o link mostra página não encontrada.</span></span>
        <input type="checkbox" role="switch" checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })} className="h-6 w-6 accent-[rgb(var(--c-primary))]" />
      </label>

      <div className="mt-5 grid gap-4">
        <label className="text-sm font-medium text-ink">Endereço da página
          <div className="mt-1 flex min-w-0 items-center overflow-hidden rounded-lg border border-line bg-white focus-within:ring-2 focus-within:ring-primary/30">
            <span className="shrink-0 truncate bg-wash px-3 py-3 text-sm text-muted">/v/</span>
            <input value={form.slug} onChange={(event) => update({ slug: normalizeSlugInput(event.target.value) })} maxLength={40} placeholder="seu-nome" className="h-11 min-w-0 flex-1 px-3 text-ink outline-none" />
          </div>
          {form.slug && !slugCheck.ok ? <span className="mt-1 block text-xs text-red-700">{slugCheck.error}</span> : <span className="mt-1 block text-xs font-normal text-muted">Letras sem acento, números e hífen. Exemplo: ana-achados</span>}
        </label>
        <label className="text-sm font-medium text-ink">Título<input value={form.title} onChange={(event) => update({ title: event.target.value })} maxLength={60} placeholder="Ofertas da Ana" className={input} /></label>
        <label className="text-sm font-medium text-ink">Frase curta<input value={form.bio} onChange={(event) => update({ bio: event.target.value })} maxLength={140} placeholder="Achadinhos com desconto todo dia" className={input} /></label>
        <label className="flex items-center gap-3 text-sm text-ink">
          <input type="checkbox" checked={form.useProfilePhoto} disabled={!loaded.profilePhotoUrl} onChange={(event) => update({ useProfilePhoto: event.target.checked })} className="h-5 w-5 accent-[rgb(var(--c-primary))]" />
          {loaded.profilePhotoUrl ? <img src={loaded.profilePhotoUrl} alt="" className="h-9 w-9 rounded-full object-cover" /> : null}
          <span>{loaded.profilePhotoUrl ? "Usar minha foto de perfil" : "Sem foto de perfil. Envie uma na aba Minha conta."}</span>
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-ink">Lojas que aparecem</legend>
          <div className="mt-2 flex flex-wrap gap-2">{OFFER_PAGE_STORES.map((store) => <label key={store} className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm ${form.stores.includes(store) ? "border-primary bg-primary/10 text-ink" : "border-line bg-white text-muted"}`}>
            <input type="checkbox" className="sr-only" checked={form.stores.includes(store)} onChange={() => toggleStore(store)} />{form.stores.includes(store) ? <Check size={15} /> : null}{STORE_LABELS[store]}
          </label>)}</div>
          {!form.stores.length ? <span className="mt-1 block text-xs text-red-700">Escolha pelo menos uma loja.</span> : null}
        </fieldset>
      </div>

      {error ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {syncing ? <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-wash p-3 text-sm text-muted"><Loader2 size={16} className="animate-spin" />{syncing}</div> : null}
      {message ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={save} disabled={saving || !slugCheck.ok || !form.stores.length} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : null} Salvar vitrine</button>
        {publicLink ? <>
          <button type="button" onClick={copyLink} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink">{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? "Link copiado" : "Copiar link"}</button>
          {loaded.settings?.enabled ? <a href={publicLink} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink"><ExternalLink size={16} /> Abrir página</a> : null}
        </> : null}
      </div>
      {publicLink ? <p className="mt-3 break-all text-xs text-muted">{publicLink}</p> : null}
      {loaded.settings ? <button type="button" disabled={Boolean(syncing) || saving} onClick={() => syncSentOffers().then(load).catch((e) => { setSyncing(""); setError(e.message); })} className="mt-3 text-sm font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50">Buscar de novo as ofertas enviadas</button> : null}
    </div>

    <div className="rounded-lg border border-line bg-[#FAF5EE] p-4 shadow-soft sm:p-6">
      <h3 className="mb-1 font-semibold text-ink">Prévia</h3>
      <p className="mb-4 text-sm text-muted">{loaded.items.length ? `${loaded.items.length} ofertas aparecem hoje na sua página.` : "Assim fica a sua página."}</p>
      <OfferPageGrid items={loaded.items} preview />
    </div>
  </section>;
}
