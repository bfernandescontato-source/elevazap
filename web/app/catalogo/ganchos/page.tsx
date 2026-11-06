"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Eye, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { AppShell, ConfirmModal, ErrorState, LoadingState, Toast } from "@/components/ui";
import { CatalogTabs, useCatalogAgendaEnabled } from "@/components/catalog/catalog-tabs";

type Mode = "system" | "own_sequence" | "own_random" | "fixed" | "ai";
type Hook = { id: string; text: string; position: number };
type Config = { mode: Mode; mixSystem: boolean; fixedHookId: string | null; hooks: Hook[]; maxHooks: number; aiAvailable: boolean; systemHooks: { general: string[]; discount: string[] } };

const MODES: Array<{ id: Mode; title: string; text: string }> = [
  { id: "system", title: "Ganchos do sistema", text: "Sorteamos um dos ganchos aprovados do Disparei. É o padrão." },
  { id: "own_sequence", title: "Meus ganchos em ordem", text: "Cada oferta usa o próximo gancho da sua lista. Depois do último, volta ao primeiro." },
  { id: "own_random", title: "Meus ganchos aleatórios", text: "Cada oferta sorteia um gancho da sua lista." },
  { id: "fixed", title: "Gancho fixo", text: "Todas as ofertas usam o mesmo gancho. Escolha qual na sua lista." },
  { id: "ai", title: "Gancho com IA", text: "A IA cria um gancho novo para cada oferta. Se ela não responder, usamos os seus ganchos ou os do sistema." }
];

async function call(method: string, url: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não deu certo. Tente de novo.");
  return data;
}

export default function GanchosPage() {
  const agendaEnabled = useCatalogAgendaEnabled();
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<Mode>("system");
  const [mixSystem, setMixSystem] = useState(false);
  const [fixedHookId, setFixedHookId] = useState<string | null>(null);
  const [newHook, setNewHook] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [removing, setRemoving] = useState<Hook | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [preview, setPreview] = useState<{ message: string; usedAi: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const data: Config = await call("GET", "/api/ganchos");
      setConfig(data); setMode(data.mode); setMixSystem(data.mixSystem); setFixedHookId(data.fixedHookId); setLoadError("");
    } catch (current) { setLoadError(current instanceof Error ? current.message : "Não foi possível carregar seus ganchos."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2500); return () => clearTimeout(timer); }, [toast]);

  const run = async (key: string, action: () => Promise<unknown>, done?: string) => {
    setBusy(key); setError("");
    try { await action(); await load(); if (done) setToast(done); }
    catch (current) { setError(current instanceof Error ? current.message : "Não deu certo. Tente de novo."); }
    finally { setBusy(""); }
  };

  const saveMode = () => run("mode", () => call("PUT", "/api/ganchos", { mode, mixSystem, fixedHookId: fixedHookId && config?.hooks.some(h => h.id === fixedHookId) ? fixedHookId : null }), "Modo salvo.");
  const addHook = () => { const text = newHook.trim(); if (!text) return; void run("add", async () => { await call("POST", "/api/ganchos", { text }); setNewHook(""); }, "Gancho adicionado."); };
  const saveEdit = () => { if (!editing) return; const current = editing; void run(`edit:${current.id}`, async () => { await call("PATCH", "/api/ganchos", current); setEditing(null); }, "Gancho salvo."); };
  const move = (id: string, direction: "up" | "down") => run(`move:${id}`, () => call("PATCH", "/api/ganchos", { id, move: direction }));
  const remove = () => { if (!removing) return; const current = removing; void run(`delete:${current.id}`, async () => { await call("DELETE", "/api/ganchos", { id: current.id }); if (fixedHookId === current.id) setFixedHookId(null); setRemoving(null); }, "Gancho apagado."); };
  const showPreview = async () => {
    setBusy("preview"); setError("");
    try { const data = await call("POST", "/api/ganchos/previa"); setPreview({ message: data.message, usedAi: data.usedAi }); }
    catch (current) { setError(current instanceof Error ? current.message : "Não foi possível montar o exemplo."); }
    finally { setBusy(""); }
  };

  const hooks = config?.hooks || [];
  const usesOwn = mode === "own_sequence" || mode === "own_random" || mode === "fixed";
  const changed = config && (mode !== config.mode || mixSystem !== config.mixSystem || (mode === "fixed" && fixedHookId !== config.fixedHookId));
  const full = hooks.length >= (config?.maxHooks || 50);

  return <AppShell title="Ganchos" subtitle="O gancho é a primeira linha das suas ofertas. Vale para o Catálogo e para o Piloto Automático.">
    <div className="space-y-5">
      <CatalogTabs active="ganchos" agenda={agendaEnabled}/>
      {loadError ? <ErrorState message={loadError}/> : !config ? <LoadingState/> : <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-5">
          <section className="rounded-xl border border-line bg-panel p-4 sm:p-5">
            <h2 className="font-semibold text-ink">Como escolher o gancho</h2>
            <div className="mt-3 grid gap-2">{MODES.map(item => <label key={item.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${mode === item.id ? "border-primary bg-wash" : "border-line"}`}>
              <input type="radio" name="mode" className="mt-1" checked={mode === item.id} onChange={() => setMode(item.id)}/>
              <span><span className="flex items-center gap-1 font-medium text-ink">{item.id === "ai" ? <Sparkles size={14}/> : null}{item.title}</span><span className="mt-0.5 block text-muted">{item.text}</span></span>
            </label>)}</div>
            {(mode === "own_sequence" || mode === "own_random" || mode === "ai") && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={mixSystem} onChange={e => setMixSystem(e.target.checked)}/> Misturar com os ganchos do sistema</label>}
            {mode === "ai" && !config.aiAvailable && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">A IA ainda não está ligada no sistema. Por enquanto, usamos os seus ganchos ou os do sistema.</p>}
            {usesOwn && hooks.length === 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Você ainda não tem ganchos. Até cadastrar, usamos os do sistema.</p>}
            {mode === "fixed" && hooks.length > 0 && !fixedHookId && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Marque na lista qual gancho fica fixo.</p>}
            <button onClick={saveMode} disabled={!changed || busy === "mode" || (mode === "fixed" && !fixedHookId)} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white disabled:opacity-40 sm:w-auto">{busy === "mode" ? <Loader2 className="animate-spin" size={16}/> : <Check size={16}/>} Salvar modo</button>
          </section>

          <section className="rounded-xl border border-line bg-panel p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2"><h2 className="font-semibold text-ink">Meus ganchos</h2><span className="text-xs text-muted">{hooks.length} de {config.maxHooks}</span></div>
            <p className="mt-1 text-xs text-muted">Uma linha, até 80 caracteres, sem link. Emoji pode.</p>
            <div className="mt-3 flex gap-2">
              <input value={newHook} maxLength={80} disabled={full} onChange={e => setNewHook(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addHook(); }} placeholder="Ex.: ACHADO DA SEMANA 🔥" className="focus-ring h-11 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm"/>
              <button onClick={addHook} disabled={!newHook.trim() || busy === "add" || full} className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg bg-primary px-4 text-sm font-medium text-white disabled:opacity-40">{busy === "add" ? <Loader2 className="animate-spin" size={16}/> : <Plus size={16}/>} Adicionar</button>
            </div>
            {hooks.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted">Nenhum gancho ainda. Escreva o primeiro acima.</p>
              : <ol className="mt-3 space-y-2">{hooks.map((hook, index) => <li key={hook.id} className={`rounded-lg border p-2 text-sm ${mode === "fixed" && fixedHookId === hook.id ? "border-primary bg-wash" : "border-line"}`}>
                {editing?.id === hook.id ? <div className="flex gap-2">
                  <input autoFocus value={editing.text} maxLength={80} onChange={e => setEditing({ id: hook.id, text: e.target.value })} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); }} className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3"/>
                  <button onClick={saveEdit} disabled={!editing.text.trim() || busy === `edit:${hook.id}`} aria-label="Salvar gancho" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-white disabled:opacity-40"><Check size={16}/></button>
                  <button onClick={() => setEditing(null)} aria-label="Cancelar" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line"><X size={16}/></button>
                </div> : <div className="flex items-center gap-2">
                  {mode === "fixed" ? <input type="radio" name="fixed" aria-label="Usar este gancho fixo" checked={fixedHookId === hook.id} onChange={() => setFixedHookId(hook.id)}/> : <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted">{index + 1}</span>}
                  <span className="min-w-0 flex-1 break-words text-ink">{hook.text}</span>
                  <button onClick={() => move(hook.id, "up")} disabled={index === 0 || Boolean(busy)} aria-label="Subir" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line disabled:opacity-30"><ArrowUp size={15}/></button>
                  <button onClick={() => move(hook.id, "down")} disabled={index === hooks.length - 1 || Boolean(busy)} aria-label="Descer" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line disabled:opacity-30"><ArrowDown size={15}/></button>
                  <button onClick={() => setEditing({ id: hook.id, text: hook.text })} aria-label="Editar" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line"><Pencil size={15}/></button>
                  <button onClick={() => setRemoving(hook)} aria-label="Apagar" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-red-600"><Trash2 size={15}/></button>
                </div>}
              </li>)}</ol>}
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-xl border border-line bg-panel p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2"><h2 className="font-semibold text-ink">Exemplo</h2>
              <button onClick={showPreview} disabled={busy === "preview"} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm">{busy === "preview" ? <Loader2 className="animate-spin" size={15}/> : <Eye size={15}/>} {preview ? "Ver outro" : "Ver exemplo"}</button></div>
            <p className="mt-1 text-xs text-muted">Usa o modo salvo e um produto de exemplo.</p>
            {changed ? <p className="mt-2 text-xs text-amber-800">Salve o modo para ver o exemplo com ele.</p> : null}
            {preview ? <>
              <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-[#e9f7ee] p-3 font-sans text-sm leading-6 text-ink">{preview.message}</pre>
              {config.mode === "ai" ? <p className="mt-2 text-xs text-muted">{preview.usedAi ? "Gancho criado pela IA." : "A IA não respondeu agora. Este exemplo usa o gancho reserva."}</p> : null}
            </> : null}
          </section>

          <details className="rounded-xl border border-line bg-panel p-4 sm:p-5">
            <summary className="cursor-pointer font-semibold text-ink">Ganchos do sistema</summary>
            <ul className="mt-3 space-y-1 text-sm text-ink">{config.systemHooks.general.map(hook => <li key={hook}>{hook}</li>)}</ul>
            <p className="mt-4 text-xs font-medium text-muted">Com desconto de 20% ou mais, entram também:</p>
            <ul className="mt-2 space-y-1 text-sm text-ink">{config.systemHooks.discount.map(hook => <li key={hook}>{hook}</li>)}</ul>
          </details>
        </div>
      </div>}
      {error ? <ErrorState message={error}/> : null}
    </div>
    <ConfirmModal open={Boolean(removing)} title="Apagar gancho?" onCancel={() => setRemoving(null)} onConfirm={remove} confirmLabel="Apagar" destructive loading={Boolean(removing && busy === `delete:${removing.id}`)}>
      <p className="text-sm text-muted">{removing?.text}</p>
    </ConfirmModal>
    <Toast message={toast}/>
  </AppShell>;
}
