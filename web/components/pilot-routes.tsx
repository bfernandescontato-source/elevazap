"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Pause, Pencil, Play, Plus, Route, Search, Trash2, X } from "lucide-react";
import { ConfirmModal } from "@/components/ui";

// Rotas do Piloto por nicho: fontes + nichos → destinos (public.pilot_routes).
type Niche = { id: string; label: string; parent_id: string | null; featured: boolean };
type PilotRoute = { id: string; name: string; enabled: boolean; all_sources: boolean; source_group_ids: string[]; any_niche: boolean; niche_ids: string[]; all_destinations: boolean; destination_group_ids: string[] };
type RoutesResponse = { automationId: string | null; routes: PilotRoute[]; niches: Niche[]; sources: string[]; destinations: string[] };
type Draft = Omit<PilotRoute, "id">;

const EMPTY: Draft = { name: "", enabled: true, all_sources: false, source_group_ids: [], any_niche: false, niche_ids: [], all_destinations: false, destination_group_ids: [] };

export function PilotRoutes({ groupNames }: { groupNames: Map<string, string> }) {
  const [data, setData] = useState<RoutesResponse | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [removing, setRemoving] = useState<PilotRoute | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/piloto-automatico/rotas", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body); setError("");
    } catch (current) { setError(current instanceof Error ? current.message : "Não foi possível carregar as rotas."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const nicheLabel = useMemo(() => new Map((data?.niches || []).map(niche => [niche.id, niche.label])), [data]);
  const name = (id: string) => groupNames.get(id) || id.replace(/@g\.us$/, "");

  const mutate = async (key: string, url: string, init: RequestInit) => {
    setBusy(key); setError("");
    try {
      const response = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar.");
      await load();
      return true;
    } catch (current) { setError(current instanceof Error ? current.message : "Não foi possível salvar."); return false; }
    finally { setBusy(null); }
  };

  if (!data) return <section className="rounded-xl border border-line bg-white p-5"><Heading/>{error ? <p className="mt-4 text-sm text-red-700">{error}</p> : <div className="mt-6 flex justify-center"><Loader2 className="animate-spin text-muted"/></div>}</section>;

  const principalOpen = data.routes.some(route => route.enabled && route.all_sources && route.any_niche && route.all_destinations);
  const nicheRoutes = data.routes.some(route => route.enabled && !route.any_niche);

  return <section className="rounded-xl border border-line bg-white p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <Heading/>
      <button type="button" disabled={!data.automationId} onClick={() => setEditing({ id: null, draft: EMPTY })} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"><Plus size={16}/> Nova rota</button>
    </div>
    {!data.automationId ? <p className="mt-4 rounded-lg bg-wash p-4 text-sm text-muted">Salve o Piloto (número e grupos) para criar rotas.</p> : null}
    {principalOpen && nicheRoutes ? <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Uma rota ativa envia <b>todas</b> as ofertas para <b>todos</b> os destinos. Pause-a para que as rotas por nicho separem o conteúdo.</p> : null}
    {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {data.routes.map(route => <article key={route.id} className={`rounded-xl border p-4 ${route.enabled ? "border-line bg-panel" : "border-dashed border-line bg-wash/60"}`}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 break-words font-semibold text-ink">{route.name}</h3>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${route.enabled ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-muted"}`}>{route.enabled ? "● Ativa" : "Pausada"}</span>
        </div>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Fontes" value={route.all_sources ? `Todas as fontes (${data.sources.length})` : route.source_group_ids.map(name).join(" + ")}/>
          <Row label="Nichos" value={route.any_niche ? "Qualquer nicho" : route.niche_ids.map(id => nicheLabel.get(id) || id).join(", ")}/>
          <Row label="Destinos" value={route.all_destinations ? `Todos os destinos (${data.destinations.length})` : `${route.destination_group_ids.length} ${route.destination_group_ids.length === 1 ? "grupo" : "grupos"}`} title={route.all_destinations ? undefined : route.destination_group_ids.map(name).join(", ")}/>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Action icon={<Pencil size={14}/>} label="Editar" onClick={() => setEditing({ id: route.id, draft: { ...route } })}/>
          <Action icon={busy === `toggle:${route.id}` ? <Loader2 size={14} className="animate-spin"/> : route.enabled ? <Pause size={14}/> : <Play size={14}/>} label={route.enabled ? "Pausar" : "Ativar"} onClick={() => mutate(`toggle:${route.id}`, `/api/piloto-automatico/rotas/${route.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !route.enabled }) })}/>
          <Action icon={busy === `dup:${route.id}` ? <Loader2 size={14} className="animate-spin"/> : <Copy size={14}/>} label="Duplicar" onClick={() => mutate(`dup:${route.id}`, `/api/piloto-automatico/rotas/${route.id}/duplicar`, { method: "POST" })}/>
          <Action icon={<Trash2 size={14}/>} label="Excluir" danger onClick={() => setRemoving(route)}/>
        </div>
      </article>)}
    </div>
    {data.automationId && !data.routes.length ? <p className="mt-4 rounded-lg bg-wash p-4 text-sm text-muted">Sem rotas, o Piloto envia todas as ofertas de todas as fontes para todos os destinos.</p> : null}

    {editing ? <RouteEditor data={data} name={name} initial={editing.draft} saving={busy === "save"} onClose={() => setEditing(null)} onSave={async draft => {
      const ok = await mutate("save", editing.id ? `/api/piloto-automatico/rotas/${editing.id}` : "/api/piloto-automatico/rotas", { method: editing.id ? "PATCH" : "POST", body: JSON.stringify(draft) });
      if (ok) setEditing(null);
    }}/> : null}
    <ConfirmModal open={Boolean(removing)} title="Excluir rota?" destructive loading={busy === "delete"} confirmLabel="Excluir" onCancel={() => setRemoving(null)} onConfirm={async () => {
      if (!removing) return;
      if (await mutate("delete", `/api/piloto-automatico/rotas/${removing.id}`, { method: "DELETE" })) setRemoving(null);
    }}>A rota “{removing?.name}” deixa de distribuir ofertas. {data.routes.length === 1 ? "Sem nenhuma rota, o Piloto volta a enviar tudo para todos os destinos." : "Para só parar por um tempo, use Pausar."}</ConfirmModal>
  </section>;
}

function Heading() {
  return <div className="flex gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-100/70 text-primary"><Route size={20}/></span><div><h2 className="font-semibold text-ink">Rotas por nicho</h2><p className="mt-1 max-w-2xl text-sm text-muted">Escolha quais grupos fonte e quais nichos vão para quais grupos destino. Cada oferta segue só para as rotas que aceitam o grupo de onde ela veio e o nicho do produto.</p></div></div>;
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted">{label}</dt><dd className="min-w-0 break-words text-ink" title={title}>{value || "—"}</dd></div>;
}

function Action({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return <button type="button" onClick={onClick} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition ${danger ? "border-red-200 text-red-700 hover:bg-red-50" : "border-line text-ink hover:bg-wash"}`}>{icon}{label}</button>;
}

function RouteEditor({ data, name, initial, saving, onClose, onSave }: { data: RoutesResponse; name: (id: string) => string; initial: Draft; saving: boolean; onClose: () => void; onSave: (draft: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [query, setQuery] = useState("");
  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const toggleIn = (key: "source_group_ids" | "niche_ids" | "destination_group_ids", id: string) => set({ [key]: draft[key].includes(id) ? draft[key].filter(value => value !== id) : [...draft[key], id] } as Partial<Draft>);
  const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const niches = data.niches.filter(niche => normalize(niche.label).includes(normalize(query)));
  const parentLabel = new Map(data.niches.map(niche => [niche.id, niche.label]));

  return <div className="fixed inset-0 z-50 flex items-end bg-overlay/45 sm:grid sm:place-items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label="Rota do Piloto" className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-panel shadow-soft sm:max-w-2xl sm:rounded-2xl">
      <div className="flex items-center justify-between border-b border-line px-5 py-4"><h3 className="font-semibold text-ink">{initial.name ? "Editar rota" : "Nova rota"}</h3><button type="button" aria-label="Fechar" onClick={onClose} className="touch-target grid place-items-center rounded-full text-muted hover:bg-wash"><X size={18}/></button></div>
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <label className="block"><span className="mb-2 block text-sm font-medium text-ink">Nome da rota</span><input value={draft.name} onChange={event => set({ name: event.target.value })} placeholder="Ex.: Ofertas de Beleza" maxLength={80} className="focus-ring h-11 w-full rounded-lg border border-line bg-white px-3 text-sm"/></label>

        <Picker title="Grupos fonte" allLabel="Todas as fontes do Piloto" all={draft.all_sources} onAll={value => set({ all_sources: value })} empty="Nenhum grupo fonte salvo no Piloto.">
          {data.sources.map(id => <Check key={id} label={name(id)} checked={draft.source_group_ids.includes(id)} onChange={() => toggleIn("source_group_ids", id)}/>)}
        </Picker>

        <Picker title="Nichos" allLabel="Qualquer nicho" all={draft.any_niche} onAll={value => set({ any_niche: value })}>
          <div className="relative sm:col-span-2"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-muted"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar nicho" className="focus-ring h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm"/></div>
          {niches.map(niche => <Check key={niche.id} label={niche.label} hint={niche.parent_id ? parentLabel.get(niche.parent_id) : undefined} checked={draft.niche_ids.includes(niche.id)} onChange={() => toggleIn("niche_ids", niche.id)}/>)}
        </Picker>

        <Picker title="Grupos destino" allLabel="Todos os destinos do Piloto" all={draft.all_destinations} onAll={value => set({ all_destinations: value })} empty="Nenhum grupo destino salvo no Piloto.">
          {data.destinations.map(id => <Check key={id} label={name(id)} checked={draft.destination_group_ids.includes(id)} onChange={() => toggleIn("destination_group_ids", id)}/>)}
        </Picker>
        <p className="text-xs text-muted">As listas mostram os grupos fonte e destino já salvos no Piloto. Para usar outro grupo, marque-o acima no Piloto e clique em Salvar.</p>
      </div>
      <div className="app-safe-bottom flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-lg border border-line px-4 text-sm disabled:opacity-50">Cancelar</button>
        <button type="button" onClick={() => onSave(draft)} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin"/> : null}Salvar rota</button>
      </div>
    </div>
  </div>;
}

function Picker({ title, allLabel, all, onAll, empty, children }: { title: string; allLabel: string; all: boolean; onAll: (value: boolean) => void; empty?: string; children: React.ReactNode }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <fieldset>
    <legend className="mb-2 text-sm font-medium text-ink">{title}</legend>
    <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 text-sm"><span>{allLabel}</span><input type="checkbox" className="switch h-4 w-4 accent-primary" checked={all} onChange={event => onAll(event.target.checked)}/></label>
    {!all ? hasItems ? <div className="grid max-h-60 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">{children}</div> : <p className="rounded-lg bg-wash p-3 text-sm text-muted">{empty}</p> : null}
  </fieldset>;
}

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: () => void }) {
  return <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm transition ${checked ? "border-primary bg-primary/5" : "border-line bg-white hover:bg-wash"}`}><input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 shrink-0 accent-primary"/><span className="min-w-0 truncate">{label}{hint ? <span className="ml-1 text-xs text-muted">· {hint}</span> : null}</span></label>;
}
