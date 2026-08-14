"use client";

import { AppShell, ErrorState, LoadingState } from "@/components/ui";
import { Clock3, ExternalLink, Eye, ImageIcon, Send, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Sender = { id: string; label: string; session_name: string };
type Group = { group_jid: string; nome?: string; foto_url?: string };
type Offer = { id: string; original_text?: string; processed_text?: string; original_link?: string; affiliate_link?: string; affiliate_conversion_status?: string; affiliate_conversion_error?: string; status: string; captured_at: string; scheduled_at?: string; source_group_id?: string; grupos?: { nome?: string } | { nome?: string }[] };
type Data = {
  automation?: { id: string; whatsapp_sender_id: string; enabled: boolean; interval_minutes: number; operating_start: string; operating_end: string; timezone: string; keep_original_text: boolean; keep_original_media: boolean; avoid_duplicates: boolean; shopee_conversion_enabled: boolean; conversion_failure_policy: "pause" | "send_original" };
  shopee_integration?: { app_id: string; status: string; last_tested_at?: string; last_error?: string } | null;
  senders: Sender[]; groups: Group[]; source_group_ids: string[]; destination_group_ids: string[]; offers: Offer[];
  metrics: { captured_today: number; converted: number; queued: number; sent_today: number; ignored: number; conversion_failed: number };
};

const defaults = { whatsapp_sender_id: "", enabled: false, interval_minutes: 30, operating_start: "07:30", operating_end: "22:30", timezone: "America/Sao_Paulo", keep_original_text: true, keep_original_media: true, avoid_duplicates: true, shopee_conversion_enabled: false, conversion_failure_policy: "pause" as "pause" | "send_original", source_group_ids: [] as string[], destination_group_ids: [] as string[] };
const statusLabel: Record<string, string> = { captured: "Capturada", processing: "Processando", ready: "Pronta", scheduled: "Agendada", sending: "Enviando", sent: "Enviada", ignored: "Ignorada", duplicate: "Duplicada", processing_failed: "Falha no processamento", send_failed: "Falha no envio" };

export default function AutopilotPage() {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState(defaults);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Record<string, any> | null>(null);
  const [shopeeAppId, setShopeeAppId] = useState("");
  const [shopeeSecret, setShopeeSecret] = useState("");
  const [testingShopee, setTestingShopee] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/piloto-automatico", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar.");
      setData(body);
      setShopeeAppId(body.shopee_integration?.app_id || "");
      setForm({ ...defaults, ...(body.automation || {}), whatsapp_sender_id: body.automation?.whatsapp_sender_id || body.senders[0]?.id || "", source_group_ids: body.source_group_ids, destination_group_ids: body.destination_group_ids });
    } catch (current) { setError(current instanceof Error ? current.message : "Não foi possível carregar."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function changeSender(senderId: string) {
    setForm((current) => ({ ...current, whatsapp_sender_id: senderId, source_group_ids: [], destination_group_ids: [] }));
    const response = await fetch(`/api/whatsapp/groups?sender_id=${encodeURIComponent(senderId)}`, { cache: "no-store" });
    if (response.ok) {
      const groups = await response.json();
      setData((current) => current ? { ...current, groups } : current);
    }
  }
  async function connectShopee() {
    setTestingShopee(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/piloto-automatico/shopee", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app_id: shopeeAppId, app_secret: shopeeSecret }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível conectar à Shopee.");
      setShopeeSecret(""); setNotice("Shopee Affiliate conectada com sucesso."); await load();
    } catch (current) { setError(current instanceof Error ? current.message : "Não foi possível conectar à Shopee."); }
    finally { setTestingShopee(false); }
  }
  function toggle(list: "source_group_ids" | "destination_group_ids", id: string) {
    setForm((current) => ({ ...current, [list]: current[list].includes(id) ? current[list].filter((value) => value !== id) : [...current[list], id] }));
  }
  async function save() {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/piloto-automatico", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar.");
      setNotice("Configuração salva."); await load();
    } catch (current) { setError(current instanceof Error ? current.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }
  async function openOffer(id: string) {
    const response = await fetch(`/api/piloto-automatico/ofertas/${id}`, { cache: "no-store" });
    const body = await response.json();
    if (response.ok) setDetail(body); else setError(body.error);
  }
  async function action(id: string, actionName: "ignore" | "dispatch_now" | "edit" | "retry_conversion", text?: string) {
    const response = await fetch(`/api/piloto-automatico/ofertas/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName, text }) });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "Não foi possível atualizar a oferta.");
    setDetail(null); setNotice(actionName === "ignore" ? "Oferta ignorada." : actionName === "edit" ? "Oferta editada." : actionName === "retry_conversion" ? "Nova tentativa de conversão processada." : "Oferta priorizada para envio."); await load();
  }

  return <AppShell title="Piloto Automático" subtitle="Automatize a captura e distribuição de ofertas nos seus grupos" action={<button onClick={save} disabled={saving || !form.whatsapp_sender_id} className="h-10 rounded-lg bg-black px-4 text-sm font-medium text-white disabled:opacity-40">{saving ? "Salvando..." : "Salvar"}</button>}>
    {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}
    {notice ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
    {!data ? <LoadingState /> : <div className="space-y-6">
      <section className="flex flex-col gap-5 rounded-xl border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><Zap size={22} /></div><div><h2 className="font-semibold text-ink">Piloto Automático</h2><p className="mt-1 max-w-lg text-sm text-muted">Escolha de onde pegar, para onde enviar e deixe o Disparei organizar a fila.</p><div className={`mt-3 text-sm font-medium ${form.enabled ? "text-emerald-700" : "text-muted"}`}>{form.enabled ? "● Ativo" : "○ Desativado"}</div></div></div>
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium"><span>Ativar Piloto Automático</span><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="h-5 w-5 accent-black" /></label>
      </section>

      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6"><Metric label="Capturadas hoje" value={data.metrics.captured_today} /><Metric label="Links convertidos" value={data.metrics.converted} /><Metric label="Na fila" value={data.metrics.queued} /><Metric label="Enviadas hoje" value={data.metrics.sent_today} /><Metric label="Falhas de conversão" value={data.metrics.conversion_failed} /><Metric label="Ignoradas" value={data.metrics.ignored} /></div>

      <section className="rounded-xl border border-line bg-white p-5"><Heading title="Número responsável" description="O número precisa participar dos grupos fonte e destino." /><select value={form.whatsapp_sender_id} onChange={(event) => void changeSender(event.target.value)} className="focus-ring mt-4 h-11 w-full max-w-md rounded-lg border border-line bg-white px-3 text-sm"><option value="">Selecionar número</option>{data.senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label}</option>)}</select></section>

      <section className="rounded-xl border border-line bg-white p-5"><Heading title="Shopee Affiliate" description="Conecte sua conta para transformar automaticamente ofertas no seu link de comissão." />{data.shopee_integration?.status === "connected" ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4"><div className="font-medium text-emerald-800">● Shopee conectada</div><div className="mt-2 text-sm text-emerald-700">App ID: {data.shopee_integration.app_id}<br />App Secret: ••••••••••••••</div></div> : data.shopee_integration?.status === "error" ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4"><div className="font-medium text-red-800">● Não foi possível conectar</div><div className="mt-1 text-sm text-red-700">{data.shopee_integration.last_error || "Verifique App ID e App Secret."}</div></div> : null}<div className="mt-5 grid gap-4 md:grid-cols-2"><Field label="App ID"><input value={shopeeAppId} onChange={(event) => setShopeeAppId(event.target.value)} autoComplete="off" className="focus-ring h-11 w-full rounded-lg border border-line px-3" /></Field><Field label="App Secret"><input type="password" value={shopeeSecret} onChange={(event) => setShopeeSecret(event.target.value)} autoComplete="new-password" placeholder={data.shopee_integration ? "Informe para substituir as credenciais" : "App Secret"} className="focus-ring h-11 w-full rounded-lg border border-line px-3" /></Field></div><button type="button" onClick={() => void connectShopee()} disabled={testingShopee || !shopeeAppId || !shopeeSecret} className="mt-4 h-10 rounded-lg border border-line bg-white px-4 text-sm font-medium disabled:opacity-40">{testingShopee ? "Testando..." : "Testar conexão"}</button></section>

      <div className="grid gap-6 xl:grid-cols-2">
        <GroupPicker title="Grupos Fonte" description="Escolha os grupos onde o Disparei irá buscar novas ofertas automaticamente." groups={data.groups} selected={form.source_group_ids} onToggle={(id) => toggle("source_group_ids", id)} source />
        <GroupPicker title="Grupos de destino" description="Escolha os grupos que receberão as ofertas automaticamente." groups={data.groups} selected={form.destination_group_ids} onToggle={(id) => toggle("destination_group_ids", id)} />
      </div>

      <section className="rounded-xl border border-line bg-white p-5"><Heading title="Configuração da automação" description="Defina o ritmo e o horário em que as ofertas podem ser enviadas." /><div className="mt-5 grid gap-5 md:grid-cols-3"><Field label="Enviar 1 oferta a cada"><div className="flex items-center gap-2"><input type="number" min={5} max={1440} value={form.interval_minutes} onChange={(event) => setForm({ ...form, interval_minutes: Number(event.target.value) })} className="focus-ring h-11 w-24 rounded-lg border border-line px-3" /><span className="text-sm text-muted">minutos</span></div></Field><Field label="Início"><input type="time" value={form.operating_start} onChange={(event) => setForm({ ...form, operating_start: event.target.value })} className="focus-ring h-11 rounded-lg border border-line px-3" /></Field><Field label="Fim"><input type="time" value={form.operating_end} onChange={(event) => setForm({ ...form, operating_end: event.target.value })} className="focus-ring h-11 rounded-lg border border-line px-3" /></Field></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2"><Check label="Manter texto original" checked={form.keep_original_text} onChange={(checked) => setForm({ ...form, keep_original_text: checked })} /><Check label="Manter imagem original" checked={form.keep_original_media} onChange={(checked) => setForm({ ...form, keep_original_media: checked })} /><Check label="Evitar ofertas repetidas" checked={form.avoid_duplicates} onChange={(checked) => setForm({ ...form, avoid_duplicates: checked })} /><Check label="Trocar link Shopee automaticamente" checked={form.shopee_conversion_enabled} onChange={(checked) => setForm({ ...form, shopee_conversion_enabled: checked })} /><Disabled label="Reescrever mensagem com IA" /></div>
        {form.shopee_conversion_enabled ? <div className="mt-5"><div className="mb-2 text-sm font-medium">Em caso de erro na conversão</div><label className="mr-5 text-sm"><input type="radio" className="mr-2 accent-black" checked={form.conversion_failure_policy === "pause"} onChange={() => setForm({ ...form, conversion_failure_policy: "pause" })} />Pausar esta oferta</label><label className="text-sm"><input type="radio" className="mr-2 accent-black" checked={form.conversion_failure_policy === "send_original"} onChange={() => setForm({ ...form, conversion_failure_policy: "send_original" })} />Enviar mesmo assim</label></div> : null}
      </section>

      <section className="rounded-xl border border-line bg-white"><div className="border-b border-line p-5"><Heading title="Ofertas capturadas" description="Acompanhe o que entrou e quando cada oferta será distribuída." /></div>{data.offers.length ? <div className="divide-y divide-line">{data.offers.map((offer) => <OfferRow key={offer.id} offer={offer} onOpen={() => void openOffer(offer.id)} onAction={action} />)}</div> : <div className="p-10 text-center text-sm text-muted">Nenhuma oferta capturada ainda.</div>}</section>
    </div>}
    {detail ? <OfferModal offer={detail} onClose={() => setDetail(null)} onAction={action} /> : null}
  </AppShell>;
}

function Heading({ title, description }: { title: string; description: string }) { return <div><h2 className="font-semibold text-ink">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-line bg-white p-4"><div className="text-2xl font-semibold text-ink">{value}</div><div className="mt-1 text-sm text-muted">{label}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="mb-2 block text-sm font-medium text-ink">{label}</span>{children}</label>; }
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="flex items-center gap-3 rounded-lg border border-line p-3 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-black" />{label}</label>; }
function Disabled({ label }: { label: string }) { return <div className="flex items-center justify-between rounded-lg border border-dashed border-line bg-wash p-3 text-sm text-muted"><span>{label}</span><span className="rounded-full bg-zinc-200 px-2 py-1 text-[11px] font-semibold">Em breve</span></div>; }
function GroupPicker({ title, description, groups, selected, onToggle, source = false }: { title: string; description: string; groups: Group[]; selected: string[]; onToggle: (id: string) => void; source?: boolean }) { return <section className="rounded-xl border border-line bg-white p-5"><Heading title={title} description={description} /><div className="mt-4 max-h-72 space-y-2 overflow-y-auto">{groups.length ? groups.map((group) => <label key={group.group_jid} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-3 hover:bg-wash"><input type="checkbox" checked={selected.includes(group.group_jid)} onChange={() => onToggle(group.group_jid)} className="h-4 w-4 accent-black" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{group.nome || group.group_jid}</span>{source && selected.includes(group.group_jid) ? <span className="text-xs font-medium text-emerald-700">● Monitorando</span> : null}</label>) : <p className="rounded-lg bg-wash p-4 text-sm text-muted">Selecione um número com grupos sincronizados.</p>}</div></section>; }
function groupName(offer: Offer) { const value = offer.grupos; return Array.isArray(value) ? value[0]?.nome : value?.nome; }
function OfferRow({ offer, onOpen, onAction }: { offer: Offer; onOpen: () => void; onAction: (id: string, action: "ignore" | "dispatch_now") => void }) { return <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] lg:items-center"><div className="min-w-0"><div className="truncate font-medium text-ink">{offer.original_text?.split("\n")[0] || "Oferta com imagem"}</div><div className="mt-1 text-xs text-muted">Fonte: {groupName(offer) || offer.source_group_id || "—"} · {new Date(offer.captured_at).toLocaleString("pt-BR")}</div></div><div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${offer.status === "sent" ? "bg-emerald-100 text-emerald-800" : offer.status.includes("failed") ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{statusLabel[offer.status] || offer.status}</span></div><div className="text-sm text-muted">{offer.scheduled_at ? <><Clock3 className="mr-1 inline" size={14} />{new Date(offer.scheduled_at).toLocaleString("pt-BR")}</> : "Sem agendamento"}</div><div className="flex gap-2"><button onClick={onOpen} className="grid h-9 w-9 place-items-center rounded-lg border border-line" title="Ver"><Eye size={16} /></button>{["ready", "scheduled", "send_failed"].includes(offer.status) ? <button onClick={() => onAction(offer.id, "dispatch_now")} className="grid h-9 w-9 place-items-center rounded-lg border border-line" title="Disparar agora"><Send size={16} /></button> : null}{!["sent", "sending", "ignored"].includes(offer.status) ? <button onClick={() => onAction(offer.id, "ignore")} className="h-9 rounded-lg border border-line px-3 text-xs">Ignorar</button> : null}</div></div>; }
function OfferModal({ offer, onClose, onAction }: { offer: Record<string, any>; onClose: () => void; onAction: (id: string, action: "ignore" | "dispatch_now" | "edit" | "retry_conversion", text?: string) => void }) { const [text, setText] = useState(offer.processed_text || offer.original_text || ""); const deliveries = offer.offer_deliveries || []; return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-line p-5"><div><h2 className="font-semibold">Detalhe da oferta</h2><p className="mt-1 text-sm text-muted">{statusLabel[offer.status] || offer.status}</p></div><button onClick={onClose} className="text-sm text-muted">Fechar</button></div><div className="space-y-5 p-5">{offer.media_url ? <img src={offer.media_url} alt="Imagem da oferta" className="max-h-72 w-full rounded-lg bg-wash object-contain" /> : <div className="grid h-28 place-items-center rounded-lg bg-wash text-muted"><ImageIcon /></div>}<div><div className="mb-2 text-sm font-medium">Texto original</div><div className="whitespace-pre-wrap rounded-lg bg-wash p-3 text-sm">{offer.original_text || "—"}</div></div><Field label="Texto que será enviado"><textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} className="focus-ring w-full rounded-lg border border-line p-3 text-sm" /></Field><div className="grid gap-4 sm:grid-cols-2"><Info label="Grupo fonte" value={(Array.isArray(offer.grupos) ? offer.grupos[0]?.nome : offer.grupos?.nome) || offer.source_group_id || "—"} /><Info label="Capturada" value={new Date(offer.captured_at).toLocaleString("pt-BR")} /><Info label="Programada" value={offer.scheduled_at ? new Date(offer.scheduled_at).toLocaleString("pt-BR") : "—"} /><Info label="Conversão afiliada" value={offer.affiliate_conversion_status === "converted" ? "Link convertido" : offer.affiliate_conversion_status === "failed" ? `Falhou: ${offer.affiliate_conversion_error || "verifique a integração"}` : offer.affiliate_conversion_status || "Não necessária"} /></div>{offer.original_link ? <div><div className="text-xs text-muted">Link original</div><a href={offer.original_link} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-2 break-all text-sm text-blue-700">{offer.original_link}<ExternalLink size={14} /></a></div> : null}{offer.affiliate_link ? <div><div className="text-xs text-muted">Seu link</div><a href={offer.affiliate_link} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-2 break-all text-sm text-emerald-700">{offer.affiliate_link}<ExternalLink size={14} /></a></div> : null}<div><div className="mb-2 text-sm font-medium">Grupos de destino</div><div className="space-y-2">{deliveries.map((delivery: any) => <div key={delivery.id} className="flex justify-between rounded-lg bg-wash px-3 py-2 text-sm"><span>{(Array.isArray(delivery.grupos) ? delivery.grupos[0]?.nome : delivery.grupos?.nome) || delivery.destination_group_id}</span><span className="text-muted">{delivery.status}</span></div>)}</div></div><div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">{offer.affiliate_conversion_status === "failed" ? <button onClick={() => onAction(offer.id, "retry_conversion")} className="h-10 rounded-lg border border-red-200 px-4 text-sm text-red-700">Tentar novamente</button> : null}<button onClick={() => onAction(offer.id, "edit", text)} className="h-10 rounded-lg border border-line px-4 text-sm">Salvar edição</button>{["ready", "scheduled", "send_failed"].includes(offer.status) ? <button onClick={() => onAction(offer.id, "dispatch_now")} className="h-10 rounded-lg bg-black px-4 text-sm text-white">Disparar agora</button> : null}</div></div></div></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div><div className="text-xs text-muted">{label}</div><div className="mt-1 text-sm font-medium text-ink">{value}</div></div>; }
