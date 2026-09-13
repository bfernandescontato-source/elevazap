import { createHash } from "node:crypto";
import type { ParsedPurchaseEvent } from "./hubla-parser";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractElevaPayCredential(headers: Headers, body: unknown): string | null {
  const root = asObject(body);
  const authorization = str(headers.get("authorization"));
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
  // A ElevaPay envia "Authorization: <token>" puro, sem prefixo Bearer.
  const rawAuthorization = bearer ? null : authorization;
  return str(headers.get("x-elevapay-token"))
    ?? str(headers.get("x-api-key"))
    ?? str(headers.get("api-key"))
    ?? bearer
    ?? rawAuthorization
    ?? str(root.apiKey)
    ?? str(root.api_key);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Regra da ElevaPay para "Venda aprovada" (order.paid). A tela permite enviar estes
// campos diretamente; os fallbacks mantêm compatibilidade com nomes comuns de APIs.
export function parseElevaPayOrderPaid(body: unknown): ParsedPurchaseEvent & { providerEventId: string } {
  const root = asObject(body);
  const data = asObject(root.data);
  const order = asObject(root.order);
  const customer = asObject(root.customer);
  const amount = num(root.amountCents) ?? num(root.amount_cents) ?? num(data.amountCents);
  const providerEventId = str(root.transactionId) ?? str(root.transaction_id) ?? str(root.orderId) ?? str(root.order_id) ?? str(order.id) ?? str(data.transactionId) ?? str(data.transaction_id) ?? str(data.orderId) ?? str(data.order_id) ?? str(data.id) ?? str(root.id);
  const productId = str(root.productId) ?? str(root.product_id) ?? str(data.productId) ?? str(data.product_id) ?? str(order.productId);
  const productName = str(root.productName) ?? str(root.product_name) ?? str(data.productName) ?? str(data.product_name);
  const customerName = str(root.name) ?? str(root.customerName) ?? str(root.customer_name) ?? str(customer.name) ?? str(data.name);
  const customerPhone = str(root.phoneNumber) ?? str(root.phone_number) ?? str(root.phone) ?? str(customer.phone) ?? str(data.phoneNumber) ?? str(data.phone);
  const customerEmail = str(root.email) ?? str(root.customerEmail) ?? str(root.customer_email) ?? str(customer.email) ?? str(data.email);
  // O formato SendFlow mostrado na ElevaPay não inclui o ID do pedido. Nesse caso,
  // a assinatura dos campos enviados evita repetição do mesmo payload. IDs de pedido
  // ou transação continuam sendo preferidos e distinguem compras futuras iguais.
  const fallbackId = createHash("sha256").update(JSON.stringify({ productId, productName, customerName, customerPhone, customerEmail, amount })).digest("hex");

  return {
    eventType: "order.paid",
    providerEventId: providerEventId ?? `payload:${fallbackId}`,
    productId,
    productName,
    customerName,
    customerPhone,
    customerEmail,
    amountCents: amount,
    paymentUrl: str(root.paymentUrl) ?? str(root.payment_url),
    accessUrl: str(root.accessUrl) ?? str(root.access_url)
  };
}
