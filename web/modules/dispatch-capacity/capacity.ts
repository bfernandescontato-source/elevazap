// Capacidade de envio: quanto tempo cada oferta leva para chegar em todos os
// grupos e se a fila vai atrasar com o ritmo escolhido. Funções puras: o
// navegador usa para avisar antes de salvar e os testes conferem as contas.
//
// De onde vem o ritmo por mensagem (whatsapp-service):
// - Cada número envia os grupos de um lote por vez: claim_whatsapp_jobs só pega
//   o lote ativo do número e entrega 1 envio por número a cada volta do laço
//   (DISPATCH_POLL_MS = 1 s, src/env.ts).
// - Entre dois envios do mesmo número há no mínimo GLOBAL_SEND_THROTTLE_MS
//   (1 s, src/env.ts; aplicado em src/queue/queue.ts no execute()).
// - Cada envio de grupo ainda prepara o grupo (groupMetadata), monta o card do
//   link e criptografa para todos os participantes: em grupo grande isso leva
//   vários segundos (src/queue/queue.ts, sendGroup()).
// Medido em produção (05/11/2026): 42 grupos levam de 10 a 15 minutos com 1
// número, ou seja, de 14 a 21 s por grupo. Usamos 17 s como estimativa média.

export const SECONDS_PER_GROUP_MESSAGE = 17;
/** Com "Enviar assim que chegar", o Piloto ainda espera 1 minuto entre ofertas (pilot_send_interval). */
export const SEND_IMMEDIATELY_INTERVAL_MINUTES = 1;
/** Oferta que espera mais que isso na fila do Piloto é descartada (QUEUE_EXPIRED em promote_waiting_pilot_offers). */
export const PILOT_QUEUE_EXPIRY_MINUTES = 120;
/** Envio pendente atrasado há mais que isso acende o alerta do Início. */
export const LATE_QUEUE_ALERT_MINUTES = 30;

export type CapacityInput = {
  /** Grupos que recebem cada oferta. */
  groupsPerOffer: number;
  /** Minutos entre uma oferta e a próxima. */
  intervalMinutes: number;
  /** Quantos números dividem os grupos (1 sem divisão). */
  senders?: number;
  /** Maior quantidade de grupos que um único número recebe (quando a divisão não é por igual). */
  largestShare?: number;
  secondsPerMessage?: number;
};

export type CapacityEstimate = {
  groupsPerOffer: number;
  senders: number;
  /** Grupos do número mais carregado. */
  groupsPerSender: number;
  /** Minutos para a oferta chegar em todos os grupos. */
  minutesPerOffer: number;
  intervalMinutes: number;
  /** true quando cada oferta leva mais tempo que o intervalo: a fila cresce. */
  queueGrows: boolean;
  /** Menor intervalo (múltiplo de 5 min) que o(s) número(s) conseguem acompanhar. */
  safeIntervalMinutes: number;
  /** Números necessários para acompanhar o intervalo escolhido com divisão por igual. */
  sendersNeeded: number;
  /** Minutos de atraso que se acumulam a cada hora no ritmo escolhido. */
  delayGrowthPerHour: number;
};

function positive(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;
}

export function estimateCapacity(input: CapacityInput): CapacityEstimate {
  const groupsPerOffer = Math.max(0, Math.floor(input.groupsPerOffer || 0));
  const senders = Math.max(1, Math.floor(positive(input.senders, 1)));
  const seconds = positive(input.secondsPerMessage, SECONDS_PER_GROUP_MESSAGE);
  const intervalMinutes = positive(input.intervalMinutes, 1);
  const evenShare = Math.ceil(groupsPerOffer / senders);
  const groupsPerSender = Math.min(groupsPerOffer, Math.max(evenShare, Math.floor(input.largestShare ?? 0)));
  const minutesPerOffer = (groupsPerSender * seconds) / 60;
  const queueGrows = groupsPerOffer > 0 && minutesPerOffer > intervalMinutes;
  const safeIntervalMinutes = Math.max(5, Math.ceil(minutesPerOffer / 5) * 5);
  const sendersNeeded = groupsPerOffer > 0 ? Math.max(1, Math.ceil((groupsPerOffer * seconds) / 60 / intervalMinutes)) : 1;
  const delayGrowthPerHour = queueGrows ? Math.round((60 / intervalMinutes) * (minutesPerOffer - intervalMinutes)) : 0;
  return { groupsPerOffer, senders, groupsPerSender, minutesPerOffer, intervalMinutes, queueGrows, safeIntervalMinutes, sendersNeeded, delayGrowthPerHour };
}

function minutesLabel(minutes: number) {
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) return rounded === 1 ? "1 minuto" : `${rounded} minutos`;
  const hours = Math.floor(rounded / 60); const rest = rounded % 60;
  const hoursLabel = hours === 1 ? "1 hora" : `${hours} horas`;
  return rest ? `${hoursLabel} e ${rest} min` : hoursLabel;
}
const numbersLabel = (count: number) => count === 1 ? "1 número" : `${count} números`;
const groupsLabel = (count: number) => count === 1 ? "1 grupo" : `${count} grupos`;
function intervalLabel(minutes: number) {
  return minutes <= 1 ? "1 oferta por minuto" : `1 oferta a cada ${minutesLabel(minutes)}`;
}

export type CapacityMessage = { tone: "ok" | "warning"; title: string; lines: string[] };

/**
 * Texto curto para a tela. Ex.: "Cada oferta leva uns 12 minutos para chegar nos
 * 42 grupos com 1 número. Com 1 oferta a cada 5 minutos a fila vai atrasar."
 */
export function describeCapacity(estimate: CapacityEstimate, options: { pilot?: boolean; canSplit?: boolean } = {}): CapacityMessage | null {
  if (!estimate.groupsPerOffer) return null;
  const takes = `Cada oferta leva uns ${minutesLabel(estimate.minutesPerOffer)} para chegar nos ${groupsLabel(estimate.groupsPerOffer)} com ${numbersLabel(estimate.senders)}.`;
  if (!estimate.queueGrows) {
    return { tone: "ok", title: "Ritmo dentro do limite", lines: [takes, `Com ${intervalLabel(estimate.intervalMinutes)} a fila anda em dia.`] };
  }
  const lines = [takes, `Com ${intervalLabel(estimate.intervalMinutes)} a fila vai atrasar.`];
  lines.push(`O atraso cresce uns ${minutesLabel(estimate.delayGrowthPerHour)} a cada hora.`);
  if (options.pilot) lines.push("No Piloto, oferta que espera mais de 2 horas é descartada.");
  const fixes = [`aumente o intervalo para ${minutesLabel(estimate.safeIntervalMinutes)} ou mais`];
  if (estimate.sendersNeeded > estimate.senders) fixes.push(options.canSplit ? `divida os grupos entre ${numbersLabel(estimate.sendersNeeded)}` : `use ${numbersLabel(estimate.sendersNeeded)} nos grupos`);
  fixes.push("escolha menos grupos");
  lines.push(`Para resolver: ${fixes.join(", ou ")}.`);
  return { tone: "warning", title: "A fila vai atrasar", lines };
}

/** Menor intervalo entre duas ofertas seguidas (o trecho mais apertado da agenda). */
export function smallestIntervalMinutes(slots: Date[]): number | null {
  if (slots.length < 2) return null;
  const sorted = slots.map((slot) => slot.getTime()).sort((a, b) => a - b);
  let smallest = Infinity;
  for (let index = 1; index < sorted.length; index++) smallest = Math.min(smallest, sorted[index] - sorted[index - 1]);
  return Math.max(1, smallest / 60_000);
}

/** Alerta "Fila atrasada" do Início: envios pendentes que passaram do horário há mais de LATE_QUEUE_ALERT_MINUTES. */
export function describeLateQueue(lateCount: number, oldestLateMinutes: number): CapacityMessage | null {
  if (lateCount <= 0) return null;
  return {
    tone: "warning",
    title: "Fila atrasada",
    lines: [
      lateCount === 1 ? "1 envio está esperando há mais de 30 minutos." : `${lateCount.toLocaleString("pt-BR")} envios estão esperando há mais de 30 minutos.`,
      `O mais antigo está ${minutesLabel(oldestLateMinutes)} atrasado.`,
      "Isso acontece quando o número está desconectado ou quando o ritmo passa do que ele consegue enviar.",
      "Aumente o intervalo do Piloto, escolha menos grupos ou divida os grupos entre seus números."
    ]
  };
}
