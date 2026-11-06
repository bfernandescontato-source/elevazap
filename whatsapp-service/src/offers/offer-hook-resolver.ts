import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_HOOKS_PER_ACCOUNT, generateAiHook, hookNeedsSequence, offerShownPercent, selectOfferHook, type HookSettings } from "@disparei/affiliate-links/offer-hooks";
import type { OfferCopyFacts } from "./offer-copy-template.js";

const SETTINGS_TTL_MS = 60_000;
const ERROR_TTL_MS = 15_000;
const MAX_CACHED_ACCOUNTS = 5000;
const LOOKUP_TIMEOUT_MS = 3000;

type CacheEntry = { value: HookSettings | null; expires: number };
type AiOptions = { apiKey?: string | null; models?: string | null };

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Tempo esgotado ao ler os ganchos.")), ms); })
  ]);
}

/**
 * Gancho do Piloto conforme a escolha da conta em Ganchos. A configuração fica
 * em memória por 1 minuto (nada de consulta pesada por mensagem); só o modo em
 * ordem faz uma chamada curta por oferta para avançar o contador. Nunca lança:
 * sem resposta do banco ou da IA, cai nos ganchos do aluno ou nos do sistema.
 */
export class OfferHookResolver {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private database: SupabaseClient,
    private ai: AiOptions = { apiKey: process.env.OPENROUTER_API_KEY, models: process.env.HOOK_AI_MODELS },
    private now: () => number = Date.now,
    private generate: typeof generateAiHook = generateAiHook
  ) {}

  async settings(accountId: string): Promise<HookSettings | null> {
    const hit = this.cache.get(accountId);
    if (hit && hit.expires > this.now()) return hit.value;
    let value: HookSettings | null = null;
    let ttl = SETTINGS_TTL_MS;
    try {
      const [settings, hooks] = await withTimeout(Promise.all([
        this.database.from("account_offer_hook_settings").select("mode,mix_system,fixed_hook_id").eq("account_id", accountId).maybeSingle(),
        this.database.from("account_offer_hooks").select("id,text").eq("account_id", accountId)
          .order("position", { ascending: true }).order("created_at", { ascending: true }).limit(MAX_HOOKS_PER_ACCOUNT)
      ]), LOOKUP_TIMEOUT_MS);
      if (settings.error || hooks.error) throw settings.error || hooks.error;
      const rows = (hooks.data || []) as Array<{ id: string; text: string }>;
      value = settings.data ? {
        mode: settings.data.mode,
        mixSystem: settings.data.mix_system === true,
        hooks: rows.map((row) => row.text),
        fixedHook: rows.find((row) => row.id === settings.data!.fixed_hook_id)?.text || null
      } : null;
    } catch (error) {
      ttl = ERROR_TTL_MS;
      console.warn({ event: "offer_hooks_lookup_failed", component: "offer-autopilot", account_id: accountId, error: error instanceof Error ? error.message : String(error) });
    }
    if (this.cache.size >= MAX_CACHED_ACCOUNTS) this.cache.clear();
    this.cache.set(accountId, { value, expires: this.now() + ttl });
    return value;
  }

  private async nextSequence(accountId: string): Promise<number | null> {
    try {
      const { data, error } = await withTimeout(this.database.rpc("reserve_offer_hook_sequence", { p_account_id: accountId, p_count: 1 }), LOOKUP_TIMEOUT_MS);
      const value = Number(data);
      return error || !Number.isSafeInteger(value) || value < 0 ? null : value;
    } catch { return null; }
  }

  /** Gancho para esta oferta, ou undefined para o modelo sortear da lista do sistema. */
  async hookFor(accountId: string, facts: OfferCopyFacts, random: () => number = Math.random): Promise<string | undefined> {
    try {
      const settings = await this.settings(accountId);
      if (!settings || settings.mode === "system") return undefined;
      const sequence = hookNeedsSequence(settings) ? await this.nextSequence(accountId) : null;
      const aiHook = settings.mode === "ai" ? await this.generate(facts, { apiKey: this.ai.apiKey, models: this.ai.models }).catch(() => null) : null;
      return selectOfferHook(settings, { shownPercent: offerShownPercent(facts), random, sequence, aiHook });
    } catch {
      return undefined;
    }
  }
}
