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

  const firstName = str(user.firstName) ?? str(payer.firstName);
  const lastName = str(user.lastName) ?? str(payer.lastName);
  const customerName = [firstName, lastName].filter(Boolean).join(" ") || null;

  return {
    eventType: str(root.type),
    providerEventId: str(invoice.id) ?? str(invoice.orderId),
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
