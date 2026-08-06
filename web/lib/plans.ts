// Arquivo central de configuração de planos.
// Para adicionar um novo plano: inclua em OFFER_CODE_TO_PLAN e PLAN_DEFINITIONS.

export type PlanName = "start" | "pro" | "scale";

export type PlanLimits = {
  maxSenders: number;
  // Adicione novos limites aqui no futuro (ex: maxUsers, maxCampaigns)
};

export type PlanDefinition = {
  label: string;
  limits: PlanLimits;
};

// Offer codes da Hubla → nome canônico do plano
export const OFFER_CODE_TO_PLAN: Record<string, PlanName> = {
  LI3Txcm3rWNDfrCIybVW: "start",
  BRRDudofJKxPpKFJHBxe: "pro",
  "3kJ87CEotVEFhsSsGCYC": "scale",
};

// Definição central de cada plano — altere limites apenas aqui
export const PLAN_DEFINITIONS: Record<PlanName, PlanDefinition> = {
  start: { label: "START",  limits: { maxSenders: 1  } },
  pro:   { label: "PRO",    limits: { maxSenders: 3  } },
  scale: { label: "SCALE",  limits: { maxSenders: 10 } },
};

// Sentinel para contas sem plano definido (legado/migradas): sem limite
export const UNLIMITED_SENDERS = 9999;

export function getPlanFromOfferCode(offerCode: string): PlanName | null {
  return OFFER_CODE_TO_PLAN[offerCode] ?? null;
}

export function getPlanLimits(plan: string): PlanLimits {
  const normalized = plan.toLowerCase() as PlanName;
  return PLAN_DEFINITIONS[normalized]?.limits ?? { maxSenders: UNLIMITED_SENDERS };
}

export function getPlanLabel(plan: string): string {
  const normalized = plan.toLowerCase() as PlanName;
  return PLAN_DEFINITIONS[normalized]?.label ?? plan.toUpperCase();
}
