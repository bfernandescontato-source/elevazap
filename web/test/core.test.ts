import { describe, expect, it } from "vitest";
import { maskPhone, normalizeBrazilianPhone, phoneToWhatsAppJid, validateGroupJid } from "../lib/phone";
import { sendFlowWebhookPayloadSchema, validateMedia, webhookPayloadSchema } from "../lib/schemas";
import { canMoveToProcessing, nextQueueKind, recoverStuckStatus, shouldAutoRetry } from "../lib/state-machine";
import { buildIdempotencyKey, normalizeWebhookPayload, renderAutomationTemplate } from "../lib/webhook-automation";

describe("telefone e JID", () => {
  it("normaliza telefones brasileiros", () => {
    expect(normalizeBrazilianPhone("+55 (11) 99999-9999")).toBe("5511999999999");
    expect(normalizeBrazilianPhone("11999999999")).toBe("5511999999999");
  });

  it("gera máscara e JID", () => {
    expect(maskPhone("5511999999999")).toBe("55 11 *****-9999");
    expect(phoneToWhatsAppJid("5511999999999")).toBe("5511999999999@s.whatsapp.net");
  });

  it("valida group_jid", () => {
    expect(validateGroupJid("120363123456@g.us")).toBe(true);
    expect(validateGroupJid("5511999999999@s.whatsapp.net")).toBe(false);
  });
});

describe("webhook e mídia", () => {
  it("valida payload ElevaPay", () => {
    expect(webhookPayloadSchema.safeParse({
      event: "compra.aprovada",
      order_id: "ord_123",
      transaction_id: "txn_456",
      nome: "Fulano",
      telefone: "5511999999999",
      produto: "Shop Lab",
      email: "fulano@email.com"
    }).success).toBe(true);
  });

  it("valida payload ElevaPay no formato SendFlow", () => {
    expect(sendFlowWebhookPayloadSchema.safeParse({
      apiKey: "secret",
      phoneNumber: "5511999999999",
      name: "Fulano",
      email: "fulano@email.com"
    }).success).toBe(true);
  });

  it("rejeita mídia inválida e aceita imagem dentro do limite", () => {
    expect(validateMedia("imagem", "image/png", 1024).ok).toBe(true);
    expect(validateMedia("imagem", "video/mp4", 1024).ok).toBe(false);
    expect(validateMedia("video", "video/mp4", 30 * 1024 * 1024).ok).toBe(false);
  });

  it("normaliza payload genérico de webhook", () => {
    const payload = normalizeWebhookPayload({
      event: "approved",
      customer: { name: "Maria", email: "maria@email.com", phone: "11999999999" },
      product: { id: "prod_1", name: "Shop Lab" },
      offer: { id: "offer_1", name: "Aula" },
      order: { id: "ord_1", amount: 990 }
    });
    expect(payload.event_type).toBe("order.paid");
    expect(payload.customer.name).toBe("Maria");
    expect(payload.product_name).toBe("Shop Lab");
    expect(payload.amount).toContain("9,90");
  });

  it("renderiza template com variáveis normais, caminho bruto e fixa", () => {
    const raw = { customer: { name: "Maria" }, data: { user: { phoneNumber: "5511999999999" } } };
    const normalized = normalizeWebhookPayload({ event: "order.paid", ...raw, product_name: "Shop Lab" });
    const result = renderAutomationTemplate("Oi {{name}} {{data.user.phoneNumber}} {{group_link}} {{missing}}", normalized, raw, { group_link: "https://grupo" });
    expect(result.rendered).toContain("Oi Maria 5511999999999 https://grupo");
    expect(result.warnings).toContain("Variável sem valor: missing");
  });

  it("gera chave de idempotência estável", () => {
    const normalized = normalizeWebhookPayload({ event: "order.paid", order_id: "ord_1" });
    expect(buildIdempotencyKey("rule_1", normalized, {})).toBe("rule_1:order.paid:ord_1");
  });
});

describe("fila e estados", () => {
  it("claim_token é obrigatório para processar", () => {
    expect(canMoveToProcessing({ status: "enfileirado", claim_token: "a" }, "a")).toBe(true);
    expect(canMoveToProcessing({ status: "enfileirado", claim_token: "a" }, "b")).toBe(false);
    expect(canMoveToProcessing({ status: "pausado", claim_token: "a" }, "a")).toBe(false);
    expect(canMoveToProcessing({ status: "cancelado", claim_token: "a" }, "a")).toBe(false);
  });

  it("recupera travados sem reenviar incertos automaticamente", () => {
    const now = Date.now();
    expect(recoverStuckStatus({ status: "processando", started_at: new Date(now - 6 * 60 * 1000).toISOString() }, now)).toBe("incerto");
    expect(recoverStuckStatus({ status: "enfileirado", claimed_at: new Date(now - 16 * 60 * 1000).toISOString() }, now)).toBe("pendente");
    expect(shouldAutoRetry("incerto")).toBe(false);
  });

  it("boas-vindas têm prioridade sobre grupos e buffer pode ser pequeno", () => {
    expect(nextQueueKind(true, true)).toBe("envio");
    expect(nextQueueKind(false, true)).toBe("grupo");
  });
});
