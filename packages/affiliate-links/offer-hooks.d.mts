import type { OfferCopyFacts } from "./offer-copy.mjs";

export type HookMode = "system" | "own_sequence" | "own_random" | "fixed" | "ai";
export type HookSettings = {
  mode: HookMode;
  /** Mistura os ganchos do aluno com os do sistema. */
  mixSystem?: boolean;
  /** Ganchos do aluno, na ordem escolhida. */
  hooks: string[];
  /** Texto do gancho fixo (modo "fixed"). */
  fixedHook?: string | null;
};
export type HookContext = {
  shownPercent: number;
  random?: () => number;
  /** Posição reservada no contador da conta (modo "own_sequence"). */
  sequence?: number | null;
  /** Gancho da IA já validado (modo "ai"). */
  aiHook?: string | null;
};

export declare const HOOK_MODES: HookMode[];
export declare const MAX_HOOK_LENGTH: number;
export declare const MAX_AI_HOOK_LENGTH: number;
export declare const MAX_HOOKS_PER_ACCOUNT: number;
export declare const HOOK_AI_TIMEOUT_MS: number;

export function normalizeHookText(text: unknown): string | null;
export function offerShownPercent(facts: OfferCopyFacts): number;
export function systemHookPool(shownPercent: number): string[];
export function selectOfferHook(settings: HookSettings | null | undefined, context: HookContext): string;
export function hookNeedsSequence(settings: HookSettings | null | undefined): boolean;
export function validateAiHook(text: unknown, facts: OfferCopyFacts): string | null;
export function parseModelList(value: string | null | undefined): string[];
export function generateAiHook(facts: OfferCopyFacts, options?: {
  apiKey?: string | null;
  models?: string[] | string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<string | null>;
