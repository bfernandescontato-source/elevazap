"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

export type OfferImageMode = "original_image" | "product_link_preview";
type Settings = { defaultImageMode: OfferImageMode; discountBadge: boolean; freeShippingBadge: boolean };

export const OFFER_IMAGE_SETTINGS_HREF = "/configuracoes?aba=imagem-ofertas";

const MODES: { id: OfferImageMode; label: string; hint: string }[] = [
  { id: "original_image", label: "Imagem", hint: "A foto vai como imagem. Aparece na galeria do grupo." },
  { id: "product_link_preview", label: "Preview", hint: "A foto aparece no card do link. Não ocupa a galeria." }
];

/**
 * Formato da imagem num envio, começando no padrão da conta. Se a pessoa já
 * escolheu outro neste envio, a resposta do padrão não desfaz a escolha.
 */
export function useOfferImageMode(): [OfferImageMode, (mode: OfferImageMode) => void] {
  const [mode, setMode] = useState<OfferImageMode>("original_image");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/configuracoes/imagem-ofertas", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(data => {
      const value = data?.settings?.defaultImageMode;
      if (alive && !touched && (value === "original_image" || value === "product_link_preview")) setMode(value);
    }).catch(() => undefined);
    return () => { alive = false; };
    // Só no começo do envio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [mode, (next) => { setTouched(true); setMode(next); }];
}

export function ImageModePicker({ value, onChange, disabled = false }: { value: OfferImageMode; onChange: (mode: OfferImageMode) => void; disabled?: boolean }) {
  return <fieldset>
    <legend className="text-sm font-medium">Formato da oferta</legend>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {MODES.map(mode => <label key={mode.id} className={`cursor-pointer rounded-lg border p-3 text-sm ${value === mode.id ? "border-primary bg-wash" : "border-line"} ${disabled ? "opacity-60" : ""}`}>
        <span className="flex items-center gap-2 font-medium"><input type="radio" className="accent-primary" name="offer-image-mode" disabled={disabled} checked={value === mode.id} onChange={() => onChange(mode.id)} />{mode.label}</span>
        <span className="mt-1 block text-xs text-muted">{mode.hint}</span>
      </label>)}
    </div>
    <p className="mt-2 text-xs text-muted">
      {value === "product_link_preview" ? "Se o card não carregar, a oferta segue com texto e link. " : ""}
      <Link href={OFFER_IMAGE_SETTINGS_HREF} className="font-medium text-primary underline">Mudar padrão e selos</Link>
    </p>
  </fieldset>;
}

function Toggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (value: boolean) => void; title: string; hint: string }) {
  return <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${checked ? "border-primary bg-wash" : "border-line bg-white"}`}>
    <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={checked} onChange={event => onChange(event.target.checked)} />
    <span><span className="block text-sm font-medium text-ink">{title}</span><span className="mt-0.5 block text-xs text-muted">{hint}</span></span>
  </label>;
}

/** Seção de Configurações: formato padrão, selos e a prévia desenhada pelo servidor. */
export function OfferImageSettingsSection() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    fetch("/api/configuracoes/imagem-ofertas", { cache: "no-store" }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Não foi possível carregar.");
      setSettings(data.settings);
    }).catch(e => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, []);

  function change(next: Partial<Settings>) {
    setSettings(current => current ? { ...current, ...next } : current);
    setMessage(""); setPreviewFailed(false);
  }

  async function save() {
    if (!settings) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const r = await fetch("/api/configuracoes/imagem-ofertas", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultImageMode: settings.defaultImageMode, discountBadge: settings.discountBadge, freeShippingBadge: settings.freeShippingBadge }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Não foi possível salvar.");
      setSettings(data.settings);
      setMessage("Pronto. As próximas ofertas já saem assim.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally { setSaving(false); }
  }

  const anyBadge = Boolean(settings?.discountBadge || settings?.freeShippingBadge);
  const previewSrc = settings ? `/api/configuracoes/imagem-ofertas/previa?${new URLSearchParams({
    mode: settings.defaultImageMode === "product_link_preview" ? "card" : "original",
    discount: settings.discountBadge ? "1" : "0",
    freeShipping: settings.freeShippingBadge ? "1" : "0"
  })}` : "";

  return <section className="max-w-3xl rounded-lg border border-line bg-panel p-4 shadow-soft sm:p-6">
    <h2 className="text-lg font-semibold text-ink">Imagem das ofertas</h2>
    <p className="mt-1 text-sm text-muted">Escolha como a foto do produto sai nos grupos. Vale para o Catálogo e para as ofertas da página Cupons.</p>
    {!settings && !error ? <div className="mt-6 flex justify-center"><Loader2 className="animate-spin" /></div> : null}
    {settings ? <div className="mt-5 grid gap-6 md:grid-cols-[1fr_260px]">
      <div className="space-y-5">
        <div>
          <p className="text-sm font-medium text-ink">Formato padrão</p>
          <div className="mt-2 grid gap-2">
            {MODES.map(mode => <label key={mode.id} className={`cursor-pointer rounded-lg border p-3 ${settings.defaultImageMode === mode.id ? "border-primary bg-wash" : "border-line bg-white"}`}>
              <span className="flex items-center gap-2 text-sm font-medium text-ink"><input type="radio" className="accent-primary" name="default-image-mode" checked={settings.defaultImageMode === mode.id} onChange={() => change({ defaultImageMode: mode.id })} />{mode.label}</span>
              <span className="mt-1 block text-xs text-muted">{mode.hint}</span>
            </label>)}
          </div>
          <p className="mt-2 text-xs text-muted">Em cada envio você ainda pode trocar.</p>
        </div>
        <div>
          <p className="text-sm font-medium text-ink">Selos na foto</p>
          <div className="mt-2 grid gap-2">
            <Toggle checked={settings.discountBadge} onChange={value => change({ discountBadge: value })} title="Desconto" hint="Mostra o desconto, como -52%. Só aparece com desconto de 5% ou mais." />
            <Toggle checked={settings.freeShippingBadge} onChange={value => change({ freeShippingBadge: value })} title="Frete grátis" hint="Só aparece quando a loja informa frete grátis. Hoje isso vem do Mercado Livre." />
          </div>
          <p className="mt-2 text-xs text-muted">No Piloto, os selos entram no card do link. O formato do Piloto você escolhe na tela do Piloto.</p>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-ink">Prévia</p>
        <div className="mt-2 overflow-hidden rounded-lg border border-line bg-white">
          {previewFailed
            ? <p className="grid aspect-square place-items-center p-4 text-center text-xs text-muted">Prévia indisponível agora. Suas escolhas continuam valendo.</p>
            // eslint-disable-next-line @next/next/no-img-element
            : <img key={previewSrc} src={previewSrc} alt="Foto de exemplo com os selos escolhidos" className="aspect-square w-full object-contain" onError={() => setPreviewFailed(true)} />}
        </div>
        <p className="mt-2 text-xs text-muted">{anyBadge ? "Exemplo com 52% de desconto e frete grátis." : "Sem selos, a foto sai como a loja mandou."}</p>
      </div>
    </div> : null}
    {error ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {message ? <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><Check size={16} />{message}</p> : null}
    {settings ? <button type="button" disabled={saving} onClick={save} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">
      {saving ? <Loader2 className="animate-spin" size={16} /> : null} Salvar
    </button> : null}
  </section>;
}
