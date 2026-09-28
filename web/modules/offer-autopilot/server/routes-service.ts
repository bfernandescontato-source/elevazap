import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";

// Rotas do Piloto por nicho (public.pilot_routes). Cada rota escolhe, dentro dos
// grupos fonte e destino do Piloto, quais fontes e nichos vão para quais
// destinos. A distribuição acontece no banco (pilot_offer_destinations).

export class RouteError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

export const routeInputSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome para a rota.").max(80, "Nome muito longo."),
  enabled: z.boolean().default(true),
  all_sources: z.boolean().default(false),
  source_group_ids: z.array(z.string().min(1).max(120)).max(50).default([]),
  any_niche: z.boolean().default(false),
  niche_ids: z.array(z.string().min(1).max(60)).max(60).default([]),
  all_destinations: z.boolean().default(false),
  destination_group_ids: z.array(z.string().min(1).max(120)).max(300).default([])
});
export type RouteInput = z.infer<typeof routeInputSchema>;

const COLUMNS = "id,name,enabled,all_sources,source_group_ids,any_niche,niche_ids,all_destinations,destination_group_ids,sort,created_at,updated_at";

async function automationOf(accountId: string) {
  const { data, error } = await supabaseAdmin().from("offer_automations").select("id").eq("account_id", accountId).maybeSingle();
  if (error) throw error;
  return data?.id as string | undefined;
}

async function pilotGroups(accountId: string, automationId: string) {
  const db = supabaseAdmin();
  const [sources, destinations] = await Promise.all([
    db.from("automation_source_groups").select("whatsapp_group_id").eq("account_id", accountId).eq("automation_id", automationId).eq("enabled", true),
    db.from("automation_destinations").select("whatsapp_group_id").eq("account_id", accountId).eq("automation_id", automationId).eq("enabled", true)
  ]);
  if (sources.error) throw sources.error;
  if (destinations.error) throw destinations.error;
  return { sources: (sources.data || []).map(row => row.whatsapp_group_id as string), destinations: (destinations.data || []).map(row => row.whatsapp_group_id as string) };
}

export async function listRoutes(accountId: string) {
  const db = supabaseAdmin();
  const automationId = await automationOf(accountId);
  const { data: niches, error: nichesError } = await db.from("niches").select("id,label,parent_id,featured").eq("active", true).order("sort");
  if (nichesError) throw nichesError;
  if (!automationId) return { automationId: null, routes: [], niches: niches || [], sources: [], destinations: [] };
  const [{ data: routes, error }, groups] = await Promise.all([
    db.from("pilot_routes").select(COLUMNS).eq("account_id", accountId).eq("automation_id", automationId).order("sort").order("created_at"),
    pilotGroups(accountId, automationId)
  ]);
  if (error) throw error;
  return { automationId, routes: routes || [], niches: niches || [], ...groups };
}

async function validated(accountId: string, automationId: string, input: RouteInput) {
  const { sources, destinations } = await pilotGroups(accountId, automationId);
  // Grupo que saiu do Piloto sai da rota junto (não trava editar/pausar).
  input = { ...input, source_group_ids: input.source_group_ids.filter(id => sources.includes(id)), destination_group_ids: input.destination_group_ids.filter(id => destinations.includes(id)) };
  if (!input.all_sources && !input.source_group_ids.length) throw new RouteError("Escolha pelo menos um grupo fonte.");
  if (!input.any_niche && !input.niche_ids.length) throw new RouteError("Escolha pelo menos um nicho.");
  if (!input.all_destinations && !input.destination_group_ids.length) throw new RouteError("Escolha pelo menos um grupo destino.");
  if (input.niche_ids.length) {
    const { data, error } = await supabaseAdmin().from("niches").select("id").in("id", input.niche_ids);
    if (error) throw error;
    if ((data || []).length !== new Set(input.niche_ids).size) throw new RouteError("Nicho inválido.");
  }
  return {
    ...input,
    source_group_ids: input.all_sources ? [] : [...new Set(input.source_group_ids)],
    niche_ids: input.any_niche ? [] : [...new Set(input.niche_ids)],
    destination_group_ids: input.all_destinations ? [] : [...new Set(input.destination_group_ids)]
  };
}

async function requireAutomation(accountId: string) {
  const automationId = await automationOf(accountId);
  if (!automationId) throw new RouteError("Salve o Piloto Automático (número e grupos) antes de criar rotas.", 409);
  return automationId;
}

export async function createRoute(accountId: string, input: RouteInput) {
  const automationId = await requireAutomation(accountId);
  const db = supabaseAdmin();
  const row = await validated(accountId, automationId, input);
  const { data: last } = await db.from("pilot_routes").select("sort").eq("account_id", accountId).eq("automation_id", automationId).order("sort", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db.from("pilot_routes").insert({ ...row, account_id: accountId, automation_id: automationId, sort: (last?.sort ?? 0) + 1 }).select(COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function updateRoute(accountId: string, id: string, patch: Partial<RouteInput>) {
  const automationId = await requireAutomation(accountId);
  const db = supabaseAdmin();
  const { data: current, error: currentError } = await db.from("pilot_routes").select(COLUMNS).eq("id", id).eq("account_id", accountId).eq("automation_id", automationId).maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw new RouteError("Rota não encontrada.", 404);
  const merged = routeInputSchema.parse({ ...current, ...patch });
  const row = await validated(accountId, automationId, merged);
  const { data, error } = await db.from("pilot_routes").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).eq("account_id", accountId).select(COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function duplicateRoute(accountId: string, id: string) {
  const automationId = await requireAutomation(accountId);
  const { data: current, error } = await supabaseAdmin().from("pilot_routes").select(COLUMNS).eq("id", id).eq("account_id", accountId).eq("automation_id", automationId).maybeSingle();
  if (error) throw error;
  if (!current) throw new RouteError("Rota não encontrada.", 404);
  // A cópia nasce pausada para não duplicar envios sem querer.
  return createRoute(accountId, routeInputSchema.parse({ ...current, name: `${current.name} (cópia)`.slice(0, 80), enabled: false }));
}

export async function deleteRoute(accountId: string, id: string) {
  const automationId = await requireAutomation(accountId);
  const { data, error } = await supabaseAdmin().from("pilot_routes").delete().eq("id", id).eq("account_id", accountId).eq("automation_id", automationId).select("id");
  if (error) throw error;
  if (!data?.length) throw new RouteError("Rota não encontrada.", 404);
}
