export type ParsedHublaEvent = {
  eventType: string | null;
  providerEventId: string | null;
  productId: string | null;
  productName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  amountCents: number | null;
  paymentUrl: string | null;
  accessUrl: string | null;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Baseado no payload real observado (sandbox Hubla, evento invoice.payment_succeeded, v2.0.0).
// event.product aqui é o campo de conveniência que a Hubla expõe direto sob "event" — no payload
// observado seu id coincide com o id da offer dentro de products[0].offers, não com products[0].id.
// Campos ausentes viram null; esta função nunca lança exceção — payload inesperado não pode
// derrubar o processamento (fase seguinte decide o que fazer com null).
export function parseHublaEvent(body: unknown): ParsedHublaEvent {
  const root = asObject(body);
  const event = asObject(root.event);
  const invoice = asObject(event.invoice);
  const product = asObject(event.product);
  const user = asObject(event.user);
  const payer = asObject(invoice.payer);
  const amount = asObject(invoice.amount);
  const invoiceId = str(invoice.id) ?? str(invoice.orderId);
  const invoiceCreatedAt = str(invoice.createdAt);

  // O sandbox da Hubla reutiliza o mesmo invoice.id terminado em "-tester" em
  // execucoes diferentes. O createdAt muda a cada novo teste, mas permanece igual
  // nos retries do mesmo webhook, preservando a idempotencia nos dois casos.
  const providerEventId = invoiceId?.endsWith("-tester") && invoiceCreatedAt
    ? `${invoiceId}:${invoiceCreatedAt}`
    : invoiceId;

  const firstName = str(user.firstName) ?? str(payer.firstName);
  const lastName = str(user.lastName) ?? str(payer.lastName);
  const customerName = [firstName, lastName].filter(Boolean).join(" ") || null;

  return {
    eventType: str(root.type),
    providerEventId,
    productId: str(product.id),
    productName: str(product.name),
    customerName,
    customerPhone: str(user.phone) ?? str(payer.phone),
    customerEmail: str(user.email) ?? str(payer.email),
    amountCents: num(amount.totalCents),
    paymentUrl: null,
    accessUrl: null
  };
}
