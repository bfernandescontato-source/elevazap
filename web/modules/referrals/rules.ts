// Regras puras do "Indique e ganhe". Sem acesso a banco: usadas no servidor,
// na página de vendas e nos testes.

export const REFERRAL_LINK_BASE = "https://www.disparei.pro/";
export const REFERRAL_QUERY_PARAM = "ind";
export const REFERRAL_SRC_PREFIX = "ind_";
export const REWARD_BLOCK_SIZE = 5;
export const REWARD_BLOCK_CENTS = 2500;

const CODE_PATTERN = /^[A-Z0-9]{4,12}$/;
// Sem 0/O e 1/I/L, para o código ser fácil de ler e ditar.
const RANDOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function isValidReferralCode(value: unknown) {
  return normalizeReferralCode(value) !== null;
}

function randomInt(max: number, random: () => number) {
  return Math.floor(random() * max) % max;
}

function randomCode(length: number, random: () => number) {
  let code = "";
  for (let index = 0; index < length; index += 1) code += RANDOM_ALPHABET[randomInt(RANDOM_ALPHABET.length, random)];
  return code;
}

/**
 * Gera um código legível: primeiro nome sem acento (até 8 letras) + 2 dígitos.
 * Sem nome utilizável, usa 6 caracteres aleatórios. `attempt` > 0 aumenta a
 * variação quando o código já existe.
 */
export function generateReferralCode(name: string | null | undefined, attempt = 0, random: () => number = Math.random) {
  const firstName = String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, " ")
    .trim().split(/\s+/)[0] || "";
  const base = firstName.replace(/[^A-Z]/g, "").slice(0, 8);
  if (base.length < 2 || attempt >= 4) return randomCode(6, random);
  const digits = attempt >= 2 ? 3 : 2;
  const suffix = String(randomInt(10 ** digits, random)).padStart(digits, "0");
  return `${base}${suffix}`;
}

export function referralLink(code: string) {
  return `${REFERRAL_LINK_BASE}?${REFERRAL_QUERY_PARAM}=${encodeURIComponent(code)}`;
}

/** Acrescenta ?src=ind_<CODIGO> num link de checkout da Hubla. */
export function withReferralSrc(checkoutUrl: string, code: string | null | undefined) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return checkoutUrl;
  try {
    const url = new URL(checkoutUrl);
    url.searchParams.set("src", `${REFERRAL_SRC_PREFIX}${normalized}`);
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

function codeFromSrc(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.slice(0, REFERRAL_SRC_PREFIX.length).toLowerCase() !== REFERRAL_SRC_PREFIX) return null;
  return normalizeReferralCode(trimmed.slice(REFERRAL_SRC_PREFIX.length));
}

type AnyRecord = Record<string, any>;

/**
 * Lê o código do evento da Hubla: params.src primeiro; utm.content e
 * utm.source como reserva. Só aceita valores no formato ind_<CODIGO>.
 */
export function extractReferralCodeFromHubla(body: AnyRecord | null | undefined): string | null {
  if (!body || typeof body !== "object") return null;
  const event = body.event || body.data || body;
  const invoice = event?.invoice || body.invoice || {};
  const sessions = [invoice?.paymentSession, event?.paymentSession].filter(Boolean) as AnyRecord[];
  for (const session of sessions) {
    const candidates = [session.params?.src, session.utm?.content, session.utm?.source];
    for (const candidate of candidates) {
      const code = codeFromSrc(candidate);
      if (code) return code;
    }
  }
  return null;
}

export type ReferralStatus = "pending" | "paying" | "refunded";

export type ReferralSummary = {
  payingCount: number;
  earnedCents: number;
  paidOutCents: number;
  balanceCents: number;
  progressInBlock: number;
  remainingForNext: number;
};

/** R$ 25 a cada 5 indicados pagantes. Reembolsados já saem da contagem. */
export function rewardForPayingCount(payingCount: number) {
  const count = Math.max(0, Math.floor(payingCount));
  return Math.floor(count / REWARD_BLOCK_SIZE) * REWARD_BLOCK_CENTS;
}

export function summarizeReferrals(statuses: ReferralStatus[], payoutCents: number[]): ReferralSummary {
  const payingCount = statuses.filter((status) => status === "paying").length;
  const earnedCents = rewardForPayingCount(payingCount);
  const paidOutCents = payoutCents.reduce((sum, value) => sum + Math.max(0, Math.round(value) || 0), 0);
  const progressInBlock = payingCount % REWARD_BLOCK_SIZE;
  return {
    payingCount,
    earnedCents,
    paidOutCents,
    balanceCents: Math.max(0, earnedCents - paidOutCents),
    progressInBlock,
    remainingForNext: REWARD_BLOCK_SIZE - progressInBlock,
  };
}

export function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function firstNameOnly(value: unknown) {
  const first = String(value || "").trim().split(/\s+/)[0] || "";
  return first.slice(0, 40) || null;
}

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  pending: "Aguardando pagamento",
  paying: "Pagante",
  refunded: "Reembolsado",
};
