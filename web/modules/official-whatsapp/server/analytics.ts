import { supabaseAdmin } from "@/lib/supabase";

export type AnalyticsFilters = { start: string; end: string; type?: "all" | "automation" | "broadcast"; flowId?: string; broadcastId?: string };
type Row = { id:string; flow_id:string|null; step_id:string|null; broadcast_id:string|null; source_type?:string|null; status?:string|null; created_at:string; delivered_at?:string|null; read_at?:string|null; failed_at?:string|null; joined_group_at?:string|null; phone?:string|null; cta_id?:string|null; clicked_at?:string };
type Flow = { id:string; name:string }; type Step={id:string;flow_id:string;name:string;position:number}; type Cta={id:string;flow_step_id:string;label:string;cta_key:string};

function range(query: any, filters: AnalyticsFilters, column = "created_at") {
  return query.gte(column, filters.start).lte(column, filters.end);
}
function pct(value: number, base: number) { return base ? Math.round((value / base) * 1000) / 10 : null; }

// As consultas contam no banco e trazem somente as colunas necessárias. O detalhamento por
// contato permanece fora desta rota para a tela não carregar listas gigantes.
export async function getOfficialAnalytics(filters: AnalyticsFilters) {
  const admin = supabaseAdmin();
  let runQuery = range(admin.from("official_flow_runs").select("id,flow_id,created_at,joined_group_at"), filters);
  if (filters.flowId) runQuery = runQuery.eq("flow_id", filters.flowId);
  let messageQuery = range(admin.from("official_messages").select("id,flow_id,step_id,broadcast_id,source_type,status,created_at,delivered_at,read_at,failed_at"), filters);
  if (filters.flowId) messageQuery = messageQuery.eq("flow_id", filters.flowId);
  if (filters.broadcastId) messageQuery = messageQuery.eq("broadcast_id", filters.broadcastId);
  if (filters.type === "automation") messageQuery = messageQuery.neq("source_type", "broadcast");
  if (filters.type === "broadcast") messageQuery = messageQuery.eq("source_type", "broadcast");
  let clickQuery = range(admin.from("official_cta_clicks").select("id,flow_id,step_id,cta_id,broadcast_id,phone,clicked_at"), filters, "clicked_at");
  if (filters.flowId) clickQuery = clickQuery.eq("flow_id", filters.flowId);
  if (filters.broadcastId) clickQuery = clickQuery.eq("broadcast_id", filters.broadcastId);
  const [{ data: runs, error: runsError }, { data: messages, error: messagesError }, { data: clicks, error: clicksError }, { data: flows, error: flowsError }, { data: steps, error: stepsError }, { data: ctas, error: ctasError }] = await Promise.all([
    runQuery, messageQuery, clickQuery,
    admin.from("official_flows").select("id,name"), admin.from("official_flow_steps").select("id,flow_id,name,position").order("position"), admin.from("official_flow_ctas").select("id,flow_step_id,label,cta_key")
  ]);
  if (runsError || messagesError || clicksError || flowsError || stepsError || ctasError) throw runsError || messagesError || clicksError || flowsError || stepsError || ctasError;
  const rows = (messages || []) as Row[]; const runRows = (runs || []) as Row[]; const clickRows = (clicks || []) as Row[];
  const sent = rows.length, delivered = rows.filter((x) => x.delivered_at || x.read_at).length, read = rows.filter((x) => x.read_at).length, failed = rows.filter((x) => x.failed_at || x.status === "failed").length;
  const uniqueClickPhones = new Set(clickRows.map((x) => x.phone || x.id)).size;
  const joins = runRows.filter((x) => x.joined_group_at).length;
  const flowTable = ((flows || []) as Flow[]).map((flow) => {
    const flowRuns = runRows.filter((x) => x.flow_id === flow.id); const first = rows.filter((x) => x.flow_id === flow.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const firstStep = ((steps || []) as Step[]).filter((s) => s.flow_id === flow.id).sort((a,b) => a.position-b.position)[0]; const m = firstStep ? rows.filter((x) => x.step_id === firstStep.id) : first;
    const fDelivered = m.filter((x) => x.delivered_at || x.read_at).length, fRead = m.filter((x) => x.read_at).length, fJoins = flowRuns.filter((x) => x.joined_group_at).length;
    return { id: flow.id, name: flow.name, started: flowRuns.length, deliveryRate: pct(fDelivered,m.length), readRate: pct(fRead,fDelivered), finalConversion: pct(fJoins,flowRuns.length), joins: fJoins, failureRate: pct(m.filter((x)=>x.failed_at || x.status === "failed").length,m.length) };
  }).filter((x) => !filters.flowId || x.id === filters.flowId).filter((x) => x.started || rows.some((m)=>m.flow_id===x.id));
  const stepDetails = ((steps || []) as Step[]).filter((s) => !filters.flowId || s.flow_id === filters.flowId).map((step) => {
    const m = rows.filter((x) => x.step_id === step.id); const d = m.filter((x) => x.delivered_at || x.read_at).length; const r = m.filter((x) => x.read_at).length;
    return { ...step, reached: m.length, sent: m.length, delivered: d, deliveryRate: pct(d,m.length), read: r, readRate: pct(r,d), failed: m.filter((x)=>x.failed_at || x.status === "failed").length,
      ctas: ((ctas || []) as Cta[]).filter((c)=>c.flow_step_id===step.id).map((cta) => { const cks=clickRows.filter((c)=>c.cta_id===cta.id); const unique=new Set(cks.map((c)=>c.phone||c.id)).size; return { ...cta, uniqueClicks: unique, totalClicks: cks.length, ctrRead: pct(unique,r), ctrDelivered: pct(unique,d) }; }) };
  });
  return { filters, totals: { started: runRows.length, sent, delivered, deliveryRate:pct(delivered,sent), read, readRate:pct(read,delivered), uniqueClicks: uniqueClickPhones, joins, failures:failed, failureRate:pct(failed,sent) }, flows: flowTable, steps: stepDetails };
}

// Métricas de uma transmissão específica. Mantemos essa leitura separada da visão
// geral para que cada disparo tenha o seu próprio funil, sem misturar resultados
// de campanhas diferentes que usam o mesmo fluxo.
export async function getBroadcastPerformance(broadcastId: string) {
  const admin = supabaseAdmin();
  const [{ data: broadcast, error: broadcastError }, { data: messages, error: messagesError }, { data: clicks, error: clicksError }] = await Promise.all([
    admin.from("official_broadcasts").select("flow_id,accepted").eq("id", broadcastId).maybeSingle(),
    admin.from("official_messages").select("id,step_id,message_key,status,delivered_at,read_at,failed_at").eq("broadcast_id", broadcastId).limit(20_000),
    admin.from("official_cta_clicks").select("id,step_id,cta_id,phone").eq("broadcast_id", broadcastId).limit(20_000)
  ]);
  if (broadcastError || messagesError || clicksError) throw broadcastError || messagesError || clicksError;
  if (!broadcast) return null;

  const [{ data: steps, error: stepsError }, { data: ctas, error: ctasError }] = await Promise.all([
    admin.from("official_flow_steps").select("id,name,position,step_key").eq("flow_id", broadcast.flow_id).order("position"),
    admin.from("official_flow_ctas").select("id,flow_step_id,label,cta_key")
  ]);
  if (stepsError || ctasError) throw stepsError || ctasError;

  const messageRows = messages || [];
  const initialStep = (steps || []).find((step) => step.step_key === "initial");
  const initial = initialStep
    ? messageRows.filter((message) => message.step_id === initialStep.id)
    : messageRows.filter((message) => message.message_key === "initial");
  // Transmissões anteriores à atribuição por etapa ainda aparecem com um resumo útil.
  const firstMessages = initial.length ? initial : messageRows;
  const delivered = firstMessages.filter((message) => message.delivered_at || message.read_at || ["delivered", "read"].includes(message.status || "")).length;
  const read = firstMessages.filter((message) => message.read_at || message.status === "read").length;
  const failed = firstMessages.filter((message) => message.failed_at || message.status === "failed").length;
  const clickRows = clicks || [];

  // `accepted` é a fonte de verdade do lote: o contador de mensagens pode ter
  // lacunas nos disparos anteriores à atribuição por etapa, mas isso não torna
  // o envio menor do que foi aceito pela Meta.
  const sent = broadcast.accepted || firstMessages.length;
  return {
    sent,
    delivered,
    deliveryRate: pct(delivered, sent),
    read,
    readRate: pct(read, delivered),
    failed,
    steps: (steps || []).map((step) => ({
      id: step.id,
      name: step.name,
      position: step.position,
      sent: messageRows.filter((message) => message.step_id === step.id).length,
      ctas: (ctas || []).filter((cta) => cta.flow_step_id === step.id).map((cta) => {
        const ctaClicks = clickRows.filter((click) => click.cta_id === cta.id);
        const uniqueClicks = new Set(ctaClicks.map((click) => click.phone || click.id)).size;
        return { id: cta.id, label: cta.label, ctaKey: cta.cta_key, uniqueClicks, totalClicks: ctaClicks.length, ctrDelivered: pct(uniqueClicks, delivered), ctrRead: pct(uniqueClicks, read) };
      })
    }))
  };
}
