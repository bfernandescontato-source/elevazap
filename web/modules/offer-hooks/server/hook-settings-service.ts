import type { OfferCopyFacts } from "@disparei/affiliate-links/offer-copy";
import { MAX_HOOKS_PER_ACCOUNT, generateAiHook, hookNeedsSequence, type HookMode, type HookSettings } from "@disparei/affiliate-links/offer-hooks";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";

export class HookSettingsError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type AccountHook = { id: string; text: string; position: number };
export type AccountHookConfig = { mode: HookMode; mixSystem: boolean; fixedHookId: string | null; hooks: AccountHook[] };
export type MessageHookChoice = { settings: HookSettings | null; sequence: number | null; aiHook: string | null };

const DEFAULT_CONFIG: Omit<AccountHookConfig, "hooks"> = { mode: "system", mixSystem: false, fixedHookId: null };

/** Ganchos e modo da conta. Sem linha de configuração, vale o modo do sistema. */
export async function getHookConfig(accountId: string): Promise<AccountHookConfig> {
  const database = supabaseAdmin({ timeoutMs: 4000 });
  const [settings, hooks] = await Promise.all([
    database.from("account_offer_hook_settings").select("mode,mix_system,fixed_hook_id").eq("account_id", accountId).maybeSingle(),
    database.from("account_offer_hooks").select("id,text,position").eq("account_id", accountId)
      .order("position", { ascending: true }).order("created_at", { ascending: true }).limit(MAX_HOOKS_PER_ACCOUNT)
  ]);
  if (settings.error || hooks.error) throw new HookSettingsError("Não foi possível carregar seus ganchos.", 500);
  const row = settings.data;
  return {
    mode: (row?.mode as HookMode) || DEFAULT_CONFIG.mode,
    mixSystem: row?.mix_system === true,
    fixedHookId: row?.fixed_hook_id || null,
    hooks: (hooks.data || []).map(hook => ({ id: hook.id, text: hook.text, position: hook.position }))
  };
}

/** Configuração no formato que a escolha do gancho usa (sem ids). */
export function toHookSettings(config: AccountHookConfig): HookSettings {
  return {
    mode: config.mode,
    mixSystem: config.mixSystem,
    hooks: config.hooks.map(hook => hook.text),
    fixedHook: config.hooks.find(hook => hook.id === config.fixedHookId)?.text || null
  };
}

export async function saveHookSettings(accountId: string, input: { mode: HookMode; mixSystem: boolean; fixedHookId: string | null }) {
  const database = supabaseAdmin();
  if (input.fixedHookId) {
    const { data } = await database.from("account_offer_hooks").select("id").eq("id", input.fixedHookId).eq("account_id", accountId).maybeSingle();
    if (!data) throw new HookSettingsError("Esse gancho não existe mais. Escolha outro.");
  }
  const { error } = await database.from("account_offer_hook_settings").upsert({
    account_id: accountId, mode: input.mode, mix_system: input.mixSystem,
    fixed_hook_id: input.fixedHookId, updated_at: new Date().toISOString()
  }, { onConflict: "account_id" });
  if (error) throw new HookSettingsError("Não foi possível salvar o modo.", 500);
}

export async function addHook(accountId: string, text: string) {
  const database = supabaseAdmin();
  const { data: existing, error } = await database.from("account_offer_hooks").select("position").eq("account_id", accountId)
    .order("position", { ascending: false }).limit(MAX_HOOKS_PER_ACCOUNT);
  if (error) throw new HookSettingsError("Não foi possível salvar o gancho.", 500);
  if ((existing || []).length >= MAX_HOOKS_PER_ACCOUNT) throw new HookSettingsError(`Você pode ter até ${MAX_HOOKS_PER_ACCOUNT} ganchos.`);
  const position = existing?.length ? Number(existing[0].position) + 1 : 0;
  const { data, error: insertError } = await database.from("account_offer_hooks")
    .insert({ account_id: accountId, text, position }).select("id,text,position").single();
  if (insertError || !data) throw new HookSettingsError("Não foi possível salvar o gancho.", 500);
  return data as AccountHook;
}

export async function updateHookText(accountId: string, id: string, text: string) {
  const { data, error } = await supabaseAdmin().from("account_offer_hooks")
    .update({ text, updated_at: new Date().toISOString() }).eq("id", id).eq("account_id", accountId).select("id").maybeSingle();
  if (error) throw new HookSettingsError("Não foi possível salvar o gancho.", 500);
  if (!data) throw new HookSettingsError("Gancho não encontrado.", 404);
}

/** Troca o gancho de lugar com o vizinho (ordem do rodízio). */
export async function moveHook(accountId: string, id: string, direction: "up" | "down") {
  const { hooks } = await getHookConfig(accountId);
  const index = hooks.findIndex(hook => hook.id === id);
  if (index < 0) throw new HookSettingsError("Gancho não encontrado.", 404);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= hooks.length) return;
  const reordered = [...hooks];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  const database = supabaseAdmin();
  // Posições 0..n seguem a ordem da tela; só grava quem mudou.
  for (const [position, hook] of reordered.entries()) {
    if (hook.position === position) continue;
    const { error } = await database.from("account_offer_hooks").update({ position, updated_at: new Date().toISOString() })
      .eq("id", hook.id).eq("account_id", accountId);
    if (error) throw new HookSettingsError("Não foi possível mudar a ordem.", 500);
  }
}

export async function deleteHook(accountId: string, id: string) {
  const { error } = await supabaseAdmin().from("account_offer_hooks").delete().eq("id", id).eq("account_id", accountId);
  if (error) throw new HookSettingsError("Não foi possível apagar o gancho.", 500);
}

/** Reserva `count` posições do rodízio; null se o banco não responder. */
export async function reserveHookSequence(accountId: string, count: number): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin({ timeoutMs: 3000 }).rpc("reserve_offer_hook_sequence", { p_account_id: accountId, p_count: count });
    if (error || data === null || data === undefined) return null;
    const value = Number(data);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch { return null; }
}

/** Gancho com IA gratuita (OpenRouter). null quando não configurado ou se falhar. */
export async function aiHookFor(facts: OfferCopyFacts): Promise<string | null> {
  try {
    const { OPENROUTER_API_KEY, HOOK_AI_MODELS } = env();
    return await generateAiHook(facts, { apiKey: OPENROUTER_API_KEY, models: HOOK_AI_MODELS });
  } catch { return null; }
}

export function hookAiConfigured() {
  try { const e = env(); return Boolean(e.OPENROUTER_API_KEY && e.HOOK_AI_MODELS); } catch { return false; }
}

/**
 * Escolha do gancho para uma ou várias mensagens do Catálogo. Nunca lança:
 * se algo falhar, a mensagem sai com a lista do sistema (settings null) ou com
 * os ganchos do aluno.
 */
export async function resolveMessageHookChoices(accountId: string, factsList: OfferCopyFacts[]): Promise<MessageHookChoice[]> {
  let settings: HookSettings | null = null;
  try { settings = toHookSettings(await getHookConfig(accountId)); }
  catch (error) { console.error({ event: "offer_hooks_load_failed", component: "offer-hooks", account_id: accountId, error: error instanceof Error ? error.message : String(error) }); }
  if (!settings || settings.mode === "system") return factsList.map(() => ({ settings, sequence: null, aiHook: null }));
  const first = hookNeedsSequence(settings) ? await reserveHookSequence(accountId, factsList.length) : null;
  // A IA de cada mensagem roda em paralelo, com prazo curto (4 s no total).
  const aiHooks = settings.mode === "ai" ? await Promise.all(factsList.map(facts => aiHookFor(facts))) : factsList.map(() => null);
  return factsList.map((_, index) => ({ settings, sequence: first === null ? null : first + index, aiHook: aiHooks[index] }));
}
