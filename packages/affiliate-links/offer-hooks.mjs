/**
 * Gancho (primeira linha) da copy de oferta, escolhido conforme a conta:
 * lista do sistema, ganchos do próprio aluno (em ordem, aleatório ou fixo) ou
 * um gancho gerado por IA gratuita (OpenRouter). Qualquer falha cai, sem
 * barulho, nos ganchos do aluno e depois na lista do sistema: o envio nunca
 * espera nem quebra por causa do gancho.
 */
import { DISCOUNT_HOOKS, GENERAL_HOOKS, MIN_DISCOUNT_PERCENT, STRONG_DISCOUNT_HOOK_PERCENT, discountPercent, formatBrl } from "./offer-copy.mjs";

export const HOOK_MODES = ["system", "own_sequence", "own_random", "fixed", "ai"];
export const MAX_HOOK_LENGTH = 80;
export const MAX_AI_HOOK_LENGTH = 60;
export const MAX_HOOKS_PER_ACCOUNT = 50;
export const HOOK_AI_TIMEOUT_MS = 4000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const HAS_LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|br|net|org|me|ly|io|app)\b)/i;
const NUMBER = /\d+(?:[.,]\d+)*/g;

function pick(items, random) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/** Gancho do aluno limpo (uma linha, sem link, até 80 caracteres) ou null. */
export function normalizeHookText(text) {
  if (typeof text !== "string") return null;
  if (/[\r\n]/.test(text.trim())) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || [...clean].length > MAX_HOOK_LENGTH || HAS_LINK.test(clean)) return null;
  return clean;
}

/** O percentual que a copy vai mostrar (calculado do De/Por ou escrito na oferta), ou 0. */
export function offerShownPercent(facts) {
  const computed = discountPercent(facts.priceFromCents, facts.priceToCents);
  const stated = facts.statedDiscountPercent;
  const statedOk = !facts.priceFromCents && facts.priceToCents && stated && stated >= MIN_DISCOUNT_PERCENT && stated < 100 ? stated : null;
  return computed || statedOk || 0;
}

/** Ganchos aprovados do sistema que cabem nesta oferta. */
export function systemHookPool(shownPercent) {
  return shownPercent >= STRONG_DISCOUNT_HOOK_PERCENT ? [...DISCOUNT_HOOKS, ...GENERAL_HOOKS] : GENERAL_HOOKS;
}

/**
 * Escolhe o gancho. `sequence` é a posição reservada no contador da conta
 * (modo em ordem); sem ela o modo em ordem vira aleatório entre os do aluno.
 * `aiHook` já deve ter passado por validateAiHook.
 */
export function selectOfferHook(settings, context) {
  const random = context.random || Math.random;
  const system = systemHookPool(context.shownPercent || 0);
  const own = (settings?.hooks || []).map(normalizeHookText).filter(Boolean);
  const mode = HOOK_MODES.includes(settings?.mode) ? settings.mode : "system";
  const mix = settings?.mixSystem === true;
  const ownOrSystem = () => own.length ? pick(mix ? [...own, ...system] : own, random) : pick(system, random);

  if (mode === "ai") {
    if (context.aiHook) return context.aiHook;
    return ownOrSystem();
  }
  if (mode === "fixed") return normalizeHookText(settings?.fixedHook) || ownOrSystem();
  if (mode === "own_random") return ownOrSystem();
  if (mode === "own_sequence") {
    const sequence = context.sequence;
    if (!own.length || !Number.isSafeInteger(sequence) || sequence < 0) return ownOrSystem();
    // Misturando: posições pares seguem a ordem do aluno, ímpares sorteiam do sistema.
    if (mix) return sequence % 2 === 0 ? own[(sequence / 2) % own.length] : pick(system, random);
    return own[sequence % own.length];
  }
  return pick(system, random);
}

/** Quantas posições do contador uma mensagem consome (só o modo em ordem usa). */
export function hookNeedsSequence(settings) {
  return settings?.mode === "own_sequence" && (settings.hooks || []).some((hook) => normalizeHookText(hook));
}

function allowedNumbers(facts) {
  const numbers = new Set();
  const add = (text) => { for (const match of String(text).match(NUMBER) || []) { numbers.add(match.replace(/[.,]/g, "")); for (const part of match.split(/[.,]/)) numbers.add(part); } };
  add(facts.productName || "");
  const percent = offerShownPercent(facts);
  if (percent) add(String(percent));
  for (const cents of [facts.priceToCents, facts.priceFromCents]) if (cents) add(formatBrl(cents));
  return numbers;
}

/**
 * Valida o que a IA devolveu: uma linha, até 60 caracteres, com letras, sem
 * link e sem número que não esteja na oferta. Emoji pode. Devolve o gancho
 * limpo ou null.
 */
export function validateAiHook(text, facts) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;
  const clean = trimmed.replace(/^["'“”*_`\s-]+|["'“”*_`\s]+$/g, "").replace(/\s+/g, " ").trim();
  if (!clean || [...clean].length > MAX_AI_HOOK_LENGTH) return null;
  if (HAS_LINK.test(clean) || /[<>{}@#]/.test(clean)) return null;
  if ((clean.match(/\p{L}/gu) || []).length < 3) return null;
  const allowed = allowedNumbers(facts);
  for (const match of clean.match(NUMBER) || []) if (!allowed.has(match.replace(/[.,]/g, ""))) return null;
  return clean;
}

/** "a,b , c" -> ["a","b","c"] (lista de modelos do ambiente). */
export function parseModelList(value) {
  return String(value || "").split(",").map((model) => model.trim()).filter(Boolean).slice(0, 5);
}

function hookPrompt(facts) {
  const percent = offerShownPercent(facts);
  const lines = [`Produto: ${facts.productName}`];
  if (facts.priceToCents) lines.push(`Preço: ${formatBrl(facts.priceToCents)}`);
  if (percent) lines.push(`Desconto: ${percent}%`);
  return [
    {
      role: "system",
      content: [
        "Você escreve só o gancho (a primeira linha) de uma oferta de achadinho para grupo de WhatsApp no Brasil.",
        "Responda com UMA linha curta, em português, em letras maiúsculas, com no máximo 45 caracteres, podendo terminar com um emoji.",
        "Exemplos do tom: QUEIMA DE PREÇO 🔥 | ACHEI E VIM CORRENDO TE MOSTRAR 🏃‍♀️ | SEU BOLSO VAI AGRADECER 💸",
        "Não escreva preço, número, link, nome de loja nem aspas. Não invente desconto. Só a linha, nada mais."
      ].join("\n")
    },
    { role: "user", content: lines.join("\n") }
  ];
}

/**
 * Pede um gancho a modelos gratuitos do OpenRouter, um depois do outro, dentro
 * de um prazo total curto. Nunca lança erro: devolve o gancho validado ou null.
 */
export async function generateAiHook(facts, options = {}) {
  const apiKey = options.apiKey;
  const models = Array.isArray(options.models) ? options.models : parseModelList(options.models);
  const doFetch = options.fetch || globalThis.fetch;
  if (!apiKey || !models.length || typeof doFetch !== "function") return null;
  const deadline = Date.now() + Math.min(options.timeoutMs || HOOK_AI_TIMEOUT_MS, HOOK_AI_TIMEOUT_MS);
  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining <= 50) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await doFetch(OPENROUTER_URL, {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-title": "Disparei" },
        body: JSON.stringify({ model, messages: hookPrompt(facts), max_tokens: 60, temperature: 0.9 })
      });
      if (!response.ok) continue;
      const body = await response.json();
      const hook = validateAiHook(body?.choices?.[0]?.message?.content, facts);
      if (hook) return hook;
    } catch {
      // modelo fora do ar, sem cota ou prazo estourado: tenta o próximo
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
