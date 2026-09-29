"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Check, Copy, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";

// Caminhos do Piloto: o mesmo painel Grupos Fonte | Grupos de Destino, repetido
// em abas. Cada aba é uma rota em public.pilot_routes (fontes + nichos →
// destinos); a distribuição acontece no banco (pilot_offer_destinations), que
// junta os destinos de todos os caminhos sem repetir grupo.
// A lista geral do Piloto (automation_source_groups/destinations, que o serviço
// de WhatsApp monitora) é sempre a SOMA dos caminhos — salva antes da rota.

type Group = { group_jid: string; nome?: string };
type Niche = { id: string; label: string; parent_id: string | null; featured: boolean };
type Route = { id: string; name: string; enabled: boolean; all_sources: boolean; source_group_ids: string[]; any_niche: boolean; niche_ids: string[]; all_destinations: boolean; destination_group_ids: string[] };
type RoutesResponse = { automationId: string | null; routes: Route[]; niches: Niche[]; sources: string[]; destinations: string[]; maxSourceGroups: number };
type Draft = { id: string | null; name: string; enabled: boolean; sources: string[]; destinations: string[]; anyNiche: boolean; niches: string[] };
type PickerProps = { title: string; description: string; groups: Group[]; selected: string[]; onToggle: (id: string) => void; source?: boolean };

const iguais = (a: Draft | undefined, b: Draft | undefined) => JSON.stringify(a) === JSON.stringify(b);
const unicos = (lista: string[]) => [...new Set(lista)];

export function PilotCaminhos({ groups, saveMaster, onChanged, Picker }: {
  groups: Group[];
  saveMaster: (sources: string[], destinations: string[]) => Promise<void>;
  onChanged: () => Promise<void>;
  Picker: ComponentType<PickerProps>;
}) {
  const [info, setInfo] = useState<RoutesResponse | null>(null);
  const [ordem, setOrdem] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [originais, setOriginais] = useState<Record<string, Draft>>({});
  const [ativa, setAtiva] = useState<string>("");
  const [menu, setMenu] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const novos = useRef(0);

  const carregar = useCallback(async (manter?: string) => {
    const response = await fetch("/api/piloto-automatico/rotas", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) { setErro(body.error || "Não foi possível carregar os caminhos."); return; }
    const dados = body as RoutesResponse;
    const lista: Draft[] = dados.routes.map((rota) => ({
      id: rota.id, name: rota.name, enabled: rota.enabled,
      sources: rota.all_sources ? dados.sources : rota.source_group_ids,
      destinations: rota.all_destinations ? dados.destinations : rota.destination_group_ids,
      anyNiche: rota.any_niche, niches: rota.niche_ids
    }));
    // Sem caminho salvo ainda: o Piloto envia tudo para todos. A primeira aba
    // mostra exatamente isso, para quem salvar não mudar nada sem querer.
    if (!lista.length) lista.push({ id: null, name: "Caminho 1", enabled: true, sources: dados.sources, destinations: dados.destinations, anyNiche: true, niches: [] });
    const chaves = lista.map((d) => d.id ?? `novo-${++novos.current}`);
    const mapa = Object.fromEntries(chaves.map((k, i) => [k, lista[i]]));
    setInfo(dados); setOrdem(chaves); setDrafts(mapa); setOriginais(mapa);
    setAtiva((atual) => manter && mapa[manter] ? manter : mapa[atual] ? atual : chaves[0]);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  // A aba ativa sempre à vista (no celular as abas rolam na horizontal).
  useEffect(() => {
    document.querySelector(`[data-caminho="${ativa}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [ativa]);

  const idsDoNumero = useMemo(() => new Set(groups.map((g) => g.group_jid)), [groups]);
  const draft = drafts[ativa];
  const sujo = (chave: string) => !iguais(drafts[chave], originais[chave]);
  const editar = (patch: Partial<Draft>) => setDrafts((atual) => ({ ...atual, [ativa]: { ...atual[ativa], ...patch } }));
  const alternar = (campo: "sources" | "destinations" | "niches", id: string) =>
    editar({ [campo]: draft[campo].includes(id) ? draft[campo].filter((v) => v !== id) : [...draft[campo], id] } as Partial<Draft>);

  function trocarPara(chave: string) {
    if (chave === ativa) return;
    if (sujo(ativa) && !window.confirm("Você tem alterações não salvas neste caminho. Descartar e trocar de aba?")) return;
    descartar(ativa);
    setAtiva(chave); setMenu(null); setErro(""); setAviso("");
  }
  // Volta a aba ao que está salvo (caminho novo volta ao vazio; some pelo ⋯ › Excluir).
  function descartar(chave: string) {
    const original = originais[chave];
    if (original) setDrafts((atual) => ({ ...atual, [chave]: original }));
  }
  function novoCaminho() {
    if (sujo(ativa) && !window.confirm("Você tem alterações não salvas neste caminho. Descartar e criar um novo?")) return;
    descartar(ativa);
    const chave = `novo-${++novos.current}`;
    const d: Draft = { id: null, name: `Caminho ${ordem.length + 1}`, enabled: true, sources: [], destinations: [], anyNiche: false, niches: [] };
    setOrdem((atual) => [...atual, chave]);
    setDrafts((atual) => ({ ...atual, [chave]: d }));
    setOriginais((atual) => ({ ...atual, [chave]: d }));
    setAtiva(chave); setErro(""); setAviso("");
  }

  // Soma dos caminhos (com este rascunho no lugar do salvo), só com grupos do número atual.
  function somaCom(chave: string, d: Draft) {
    const outros = ordem.filter((k) => k !== chave && originais[k]?.id).map((k) => originais[k]);
    const fontes = unicos([...outros.flatMap((o) => o.sources), ...d.sources]).filter((id) => idsDoNumero.has(id));
    const destinos = unicos([...outros.flatMap((o) => o.destinations), ...d.destinations]).filter((id) => idsDoNumero.has(id));
    return { fontes, destinos };
  }

  async function salvar() {
    const d = { ...draft, sources: draft.sources.filter((id) => idsDoNumero.has(id)), destinations: draft.destinations.filter((id) => idsDoNumero.has(id)) };
    setErro(""); setAviso("");
    if (!d.name.trim()) return setErro("Dê um nome para o caminho.");
    if (!d.sources.length) return setErro("Escolha pelo menos um grupo fonte.");
    if (!d.destinations.length) return setErro("Escolha pelo menos um grupo de destino.");
    if (!d.anyNiche && !d.niches.length) return setErro("Escolha pelo menos um nicho, ou \"Todos os nichos\".");
    const { fontes, destinos } = somaCom(ativa, d);
    const maximo = info?.maxSourceGroups ?? 5;
    if (fontes.length > maximo) return setErro(`O limite é de ${maximo} grupos fonte somando todos os caminhos (ficaria com ${fontes.length}).`);
    setBusy("salvar");
    try {
      await saveMaster(fontes, destinos);
      const corpo = { name: d.name.trim(), enabled: d.enabled, all_sources: false, source_group_ids: d.sources, any_niche: d.anyNiche, niche_ids: d.anyNiche ? [] : d.niches, all_destinations: false, destination_group_ids: d.destinations };
      const response = await fetch(d.id ? `/api/piloto-automatico/rotas/${d.id}` : "/api/piloto-automatico/rotas", { method: d.id ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar o caminho.");
      await onChanged();
      await carregar(body.route?.id);
      setAviso("Caminho salvo.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível salvar o caminho."); }
    finally { setBusy(null); }
  }

  async function renomear(chave: string, nome: string) {
    setRenomeando(null);
    const limpo = nome.trim().slice(0, 80);
    if (!limpo || limpo === drafts[chave]?.name) return;
    const d = drafts[chave];
    setDrafts((atual) => ({ ...atual, [chave]: { ...atual[chave], name: limpo } }));
    if (!d.id) { setOriginais((atual) => ({ ...atual, [chave]: { ...atual[chave], name: limpo } })); return; }
    setBusy("renomear");
    try {
      const response = await fetch(`/api/piloto-automatico/rotas/${d.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: limpo }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível renomear.");
      setOriginais((atual) => ({ ...atual, [chave]: { ...atual[chave], name: limpo } }));
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível renomear."); setDrafts((atual) => ({ ...atual, [chave]: { ...atual[chave], name: d.name } })); }
    finally { setBusy(null); }
  }

  async function duplicar(chave: string) {
    setMenu(null);
    const d = originais[chave];
    if (!d?.id) return setErro("Salve este caminho antes de duplicar.");
    if (sujo(chave) && !window.confirm("As alterações não salvas deste caminho não vão para a cópia. Continuar?")) return;
    setBusy("duplicar"); setErro("");
    try {
      const response = await fetch(`/api/piloto-automatico/rotas/${d.id}/duplicar`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível duplicar.");
      await carregar(body.route?.id);
      setAviso("Caminho duplicado. Ajuste os grupos da cópia e salve.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível duplicar."); }
    finally { setBusy(null); }
  }

  async function excluir(chave: string) {
    setMenu(null);
    const d = drafts[chave];
    const salvos = ordem.filter((k) => originais[k]?.id);
    if (!d.id) {
      // Caminho novo que nunca foi salvo: só some da tela.
      setOrdem((atual) => atual.filter((k) => k !== chave));
      setAtiva(ordem.find((k) => k !== chave) || "");
      return;
    }
    if (salvos.length <= 1) return setErro("Mantenha pelo menos um caminho. Para parar os envios, desative o Piloto Automático.");
    if (!window.confirm(`Excluir o caminho "${d.name}"? As ofertas deixam de seguir por ele.`)) return;
    setBusy("excluir"); setErro("");
    try {
      const response = await fetch(`/api/piloto-automatico/rotas/${d.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Não foi possível excluir.");
      const restantes = salvos.filter((k) => k !== chave).map((k) => originais[k]);
      await saveMaster(unicos(restantes.flatMap((r) => r.sources)).filter((id) => idsDoNumero.has(id)), unicos(restantes.flatMap((r) => r.destinations)).filter((id) => idsDoNumero.has(id)));
      await onChanged();
      await carregar();
      setAviso("Caminho excluído.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível excluir."); }
    finally { setBusy(null); }
  }

  if (!info || !draft) return <section className="rounded-xl border border-line bg-white p-5"><div className="flex justify-center py-6"><Loader2 className="animate-spin text-muted" /></div>{erro ? <p className="text-sm text-red-700">{erro}</p> : null}</section>;

  const fontesSomadas = somaCom(ativa, draft).fontes.length;

  return <section className="space-y-4">
    <div className="flex items-end gap-2 border-b border-line">
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Caminhos do Piloto">
        {ordem.map((chave) => {
          const d = drafts[chave];
          const selecionada = chave === ativa;
          return <div key={chave} data-caminho={chave} className={`relative flex shrink-0 items-center rounded-t-lg border-b-2 ${selecionada ? "border-primary bg-white" : "border-transparent hover:bg-wash"}`}>
            {renomeando === chave
              ? <input autoFocus defaultValue={d.name} maxLength={80} aria-label="Nome do caminho" onBlur={(e) => void renomear(chave, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenomeando(null); }} className="focus-ring my-1 ml-2 h-8 w-40 rounded-md border border-line px-2 text-sm" />
              : <button type="button" role="tab" aria-selected={selecionada} onClick={() => trocarPara(chave)} onDoubleClick={() => { trocarPara(chave); setRenomeando(chave); }} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium ${selecionada ? "text-ink" : "text-muted"}`}>
                  <span className={`h-2 w-2 rounded-full ${d.enabled ? "bg-emerald-500" : "bg-zinc-300"}`} aria-hidden="true" />
                  <span className="max-w-44 truncate">{d.name}</span>
                  {sujo(chave) ? <span className="text-amber-600" title="Alterações não salvas">•</span> : null}
                </button>}
            {selecionada && renomeando !== chave ? <button type="button" aria-label="Opções do caminho" aria-expanded={menu === chave} onClick={() => setMenu(menu === chave ? null : chave)} className="mr-1 grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-wash hover:text-ink"><MoreHorizontal size={16} /></button> : null}

          </div>;
        })}
      </div>
      <button type="button" onClick={novoCaminho} className="mb-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"><Plus size={16} /> Novo caminho</button>
    </div>
    {/* Menu ⋯ fora da faixa rolável das abas (lá dentro ele ficava cortado). */}
    {menu ? <div role="menu" aria-label={`Opções de ${drafts[menu]?.name ?? "caminho"}`} className="-mt-2 flex flex-wrap gap-2 rounded-xl border border-line bg-panel p-2 shadow-soft">
      <button role="menuitem" type="button" onClick={() => { const alvo = menu; setMenu(null); setRenomeando(alvo); }} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-wash"><Pencil size={15} /> Renomear</button>
      <button role="menuitem" type="button" onClick={() => void duplicar(menu)} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-wash"><Copy size={15} /> Duplicar</button>
      <button role="menuitem" type="button" onClick={() => void excluir(menu)} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50"><Trash2 size={15} /> Excluir</button>
    </div> : null}

    <div className="grid gap-6 xl:grid-cols-2">
      <Picker title="Grupos Fonte" description="Escolha os grupos onde o Disparei irá buscar novas ofertas neste caminho." groups={groups} selected={draft.sources} onToggle={(id) => alternar("sources", id)} source />
      <Picker title="Grupos de destino" description="Escolha os grupos que receberão as ofertas deste caminho." groups={groups} selected={draft.destinations} onToggle={(id) => alternar("destinations", id)} />
    </div>

    <NichePicker niches={info.niches} anyNiche={draft.anyNiche} selected={draft.niches} onAny={(v) => editar({ anyNiche: v })} onToggle={(id) => alternar("niches", id)} />

    <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <label className="flex cursor-pointer items-center gap-3 text-sm font-medium"><input type="checkbox" className="switch h-4 w-4 accent-primary" checked={draft.enabled} onChange={(e) => editar({ enabled: e.target.checked })} /> Caminho ativo</label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="text-xs text-muted">{fontesSomadas} de {info.maxSourceGroups} grupos fonte somando todos os caminhos</span>
        <button type="button" onClick={() => void salvar()} disabled={busy !== null || !sujo(ativa)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40">{busy === "salvar" ? <Loader2 size={15} className="animate-spin" /> : null}Salvar alterações</button>
      </div>
    </div>
    {erro ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</p> : null}
    {aviso ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p> : null}
  </section>;
}

function NichePicker({ niches, anyNiche, selected, onAny, onToggle }: { niches: Niche[]; anyNiche: boolean; selected: string[]; onAny: (v: boolean) => void; onToggle: (id: string) => void }) {
  const [busca, setBusca] = useState("");
  const [todos, setTodos] = useState(false);
  const normal = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const visiveis = niches.filter((n) => (busca ? normal(n.label).includes(normal(busca)) : todos || n.featured || selected.includes(n.id)));
  const chip = (ativo: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${ativo ? "border-primary bg-primary text-white" : "border-line bg-white text-muted hover:border-zinc-400"}`;
  return <section className="rounded-xl border border-line bg-white p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h2 className="font-semibold text-ink">Nichos</h2><p className="mt-1 text-sm text-muted">Quais tipos de produto seguem por este caminho.</p></div>
      {!anyNiche ? <div className="relative sm:w-56"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-muted" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nicho" className="focus-ring h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm" /></div> : null}
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" aria-pressed={anyNiche} onClick={() => onAny(!anyNiche)} className={chip(anyNiche)}>{anyNiche ? <Check size={14} /> : null}Todos os nichos</button>
      {!anyNiche ? <>
        {visiveis.map((n) => <button key={n.id} type="button" aria-pressed={selected.includes(n.id)} onClick={() => onToggle(n.id)} className={chip(selected.includes(n.id))}>{selected.includes(n.id) ? <Check size={14} /> : null}{n.label}</button>)}
        {!busca ? <button type="button" onClick={() => setTodos((v) => !v)} className="rounded-full px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10">{todos ? "Menos nichos" : "Mais nichos"}</button> : null}
      </> : null}
    </div>
    {anyNiche ? <p className="mt-3 text-xs text-muted">Todas as ofertas destas fontes seguem por este caminho, de qualquer nicho — inclusive as que não têm nicho identificado.</p> : null}
  </section>;
}
