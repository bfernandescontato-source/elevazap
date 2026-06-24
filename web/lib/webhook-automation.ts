import { createHash } from "crypto";

export const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  "order.paid": "Venda aprovada",
  "pix.generated": "Pix gerado",
  "order.refunded": "Reembolso"
};

const eventAliases: Record<string, string> = {
  "compra.aprovada": "order.paid",
  "venda_aprovada": "order.paid",
  approved: "order.paid",
  paid: "order.paid",
  "payment.approved": "order.paid",
  "order.paid": "order.paid",
  "pix.generated": "pix.generated",
  pix_created: "pix.generated",
  "pix.gerado": "pix.generated",
  "payment.pending": "pix.generated",
  "boleto.generated": "pix.generated",
  "order.refunded": "order.refunded",
  refunded: "order.refunded",
  refund: "order.refunded",
  reembolso: "order.refunded"
};

const paths = {
  name: ["data.user.name", "customer.name", "buyer.name", "client.name", "user.name", "name"],
  email: ["data.user.email", "customer.email", "buyer.email", "client.email", "user.email", "email"],
  phone: ["data.user.phoneNumber", "data.user.phone", "customer.phone", "customer.phoneNumber", "buyer.phone", "client.phone", "user.phone", "phone", "phoneNumber", "telefone", "whatsapp"],
  product_id: ["product.id", "product_id", "data.product.id", "order.product.id", "items.0.product_id", "items.0.product.id"],
  product_name: ["product.name", "product_name", "produto", "data.product.name", "order.product.name", "items.0.product.name", "items.0.product_name"],
  offer_id: ["offer.id", "offer_id", "data.offer.id", "order.offer.id", "items.0.offer_id", "items.0.offer.id"],
  offer_name: ["offer.name", "offer_name", "data.offer.name", "order.offer.name", "items.0.offer.name", "items.0.offer_name"],
  event_type: ["event", "type", "event_type", "data.event", "action", "status"],
  external_event_id: ["id", "event_id", "external_event_id", "order.id", "order_id", "payment.id", "payment_id", "transaction.id", "transaction_id"],
  order_id: ["order.id", "order_id", "data.order.id"],
  payment_id: ["payment.id", "payment_id", "transaction.id", "transaction_id"],
  amount: ["order.amount", "amount", "data.order.amount", "payment.amount"],
  currency: ["currency", "order.currency", "payment.currency"],
  paid_at: ["paid_at", "order.paid_at", "payment.paid_at", "created_at"],
  pix_code: ["pix.code", "pix_code", "payment.pix_code"],
  pix_qr_code: ["pix.qr_code", "pix_qr_code", "payment.pix_qr_code"],
  refund_reason: ["refund.reason", "refund_reason", "reason"]
};

export const sampleWebhookVariables = {
  name: "Maria Silva",
  email: "maria@email.com",
  phone: "5511999999999",
  product_name: "Shop Lab",
  product_id: "prod_123",
  offer_name: "Aula ao vivo",
  offer_id: "offer_123",
  order_id: "order_123",
  payment_id: "pay_123",
  amount: "R$ 9,90",
  event_type: "order.paid",
  paid_at: "24/06/2026 09:50",
  pix_code: "000201010212...",
  pix_qr_code: "https://exemplo.com/qrcode",
  refund_reason: "Solicitação do cliente",
  group_link: "https://chat.whatsapp.com/exemplo",
  support_link: "https://wa.me/5511999999999"
};

export function getPath(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => {
    if (acc == null) return undefined;
    return acc[key as keyof typeof acc];
  }, obj);
}

function firstValue(body: any, list: string[]) {
  for (const path of list) {
    const value = getPath(body, path);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function normalizeEvent(value: unknown) {
  const key = String(value || "").trim().toLowerCase();
  return eventAliases[key] || key || "unknown";
}

function formatAmount(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  const numeric = Number(String(value).replace(",", "."));
  if (!Number.isFinite(numeric)) return String(value);
  const amount = Number.isInteger(numeric) && numeric >= 100 ? numeric / 100 : numeric;
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function normalizeWebhookPayload(body: any) {
  const event_type = normalizeEvent(firstValue(body, paths.event_type));
  const external_event_id = String(firstValue(body, paths.external_event_id) || "");
  const order_id = String(firstValue(body, paths.order_id) || external_event_id || "");
  const payment_id = String(firstValue(body, paths.payment_id) || external_event_id || "");
  const amount = firstValue(body, paths.amount);
  return {
    event_type,
    external_event_id: external_event_id || order_id || payment_id,
    order_id,
    payment_id,
    product_id: String(firstValue(body, paths.product_id) || ""),
    product_name: String(firstValue(body, paths.product_name) || ""),
    offer_id: String(firstValue(body, paths.offer_id) || ""),
    offer_name: String(firstValue(body, paths.offer_name) || ""),
    customer: {
      name: String(firstValue(body, paths.name) || ""),
      email: String(firstValue(body, paths.email) || ""),
      phone: String(firstValue(body, paths.phone) || "")
    },
    amount: formatAmount(amount),
    currency: String(firstValue(body, paths.currency) || "BRL"),
    paid_at: String(firstValue(body, paths.paid_at) || ""),
    pix_code: String(firstValue(body, paths.pix_code) || ""),
    pix_qr_code: String(firstValue(body, paths.pix_qr_code) || ""),
    refund_reason: String(firstValue(body, paths.refund_reason) || "")
  };
}

export function buildIdempotencyKey(ruleId: string, normalized: any, raw: any) {
  const event = normalized.event_type || "unknown";
  const external = normalized.external_event_id || normalized.order_id || normalized.payment_id;
  if (external) return `${ruleId}:${event}:${external}`;
  return `${ruleId}:${event}:${createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0, 32)}`;
}

export function renderAutomationTemplate(template: string, normalized: any, raw: any, fixedVariables: Record<string, string>) {
  const warnings: string[] = [];
  const flat: Record<string, any> = {
    name: normalized.customer?.name,
    email: normalized.customer?.email,
    phone: normalized.customer?.phone,
    "customer.name": normalized.customer?.name,
    "customer.email": normalized.customer?.email,
    "customer.phone": normalized.customer?.phone,
    "data.user.name": normalized.customer?.name,
    "data.user.email": normalized.customer?.email,
    "data.user.phone": normalized.customer?.phone,
    "data.user.phoneNumber": normalized.customer?.phone,
    product_name: normalized.product_name,
    product_id: normalized.product_id,
    offer_name: normalized.offer_name,
    offer_id: normalized.offer_id,
    order_id: normalized.order_id,
    payment_id: normalized.payment_id,
    amount: normalized.amount,
    event_type: normalized.event_type,
    paid_at: normalized.paid_at,
    pix_code: normalized.pix_code,
    pix_qr_code: normalized.pix_qr_code,
    refund_reason: normalized.refund_reason
  };
  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = flat[key] ?? getPath(raw, key) ?? fixedVariables[key];
    if (value === undefined || value === null || value === "") {
      warnings.push(`Variável sem valor: ${key}`);
      return "";
    }
    return String(value);
  });
  return { rendered, warnings: Array.from(new Set(warnings)) };
}

export function renderWithSample(template: string, fixedVariables: Record<string, string> = {}) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => String((sampleWebhookVariables as any)[key] ?? fixedVariables[key] ?? ""));
}
